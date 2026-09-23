import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { AuthGroupRole, TenantUserRole } from '../services/tenantUsers.service';
import {
  FishOrigin,
  FishStockingErrorMessages,
  FishStockingStatus,
  throwNoRightsError,
  throwValidationError,
} from '../types';
import {Setting} from "../services/settings.service";
import {FishType} from "../services/fishTypes.service";
import {FishAge} from "../services/fishAges.service";
import {FishStocking} from "../services/fishStockings.service";
import ApiGateway from "moleculer-web";
import {FishBatch} from "../services/fishBatches.service";
import {isEmpty} from "lodash";
import {add, endOfDay, isAfter, isBefore, startOfDay, sub} from "date-fns";

// Recursively remove every `$raw` key from a user-supplied query. `$raw` is the
// `@moleculer/database` knex adapter's raw-SQL sink (`whereRaw`), and the adapter
// recurses into every nested object/array — so stripping it only at the top level is
// bypassed by `query[$or][0][id][$raw]`. Server-built `$raw` clauses are added AFTER
// sanitization, so they are never seen here.
export function stripRawDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripRawDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      if (key === '$raw') continue;
      out[key] = stripRawDeep((value as Record<string, any>)[key]);
    }
    return out as T;
  }
  return value;
}

// Strip security-sensitive keys from a caller-supplied query before merging it with
// the server's tenant scope. The scope clause itself is spread in AFTER this runs, so
// a caller can no longer replace it.
const TENANT_SCOPE_FORBIDDEN_KEYS = ['$raw', 'tenants'] as const;

export function sanitizeQueryForTenantScope(query: any) {
  if (typeof query === 'string') {
    try {
      query = JSON.parse(query);
    } catch (e) {
      return {};
    }
  }
  if (!query || typeof query !== 'object') return {};

  const clean: Record<string, any> = {};
  for (const key of Object.keys(query)) {
    if ((TENANT_SCOPE_FORBIDDEN_KEYS as readonly string[]).includes(key)) continue;
    clean[key] = stripRawDeep(query[key]);
  }
  return clean;
}

export const validateCanManageTenantUser = (ctx: Context<any, UserAuthMeta>, err: string) => {
  const { profile } = ctx.meta;

  if (
    ctx.meta.authUser?.type === AuthUserRole.USER &&
    ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(ctx.meta.user.tenants[profile])
  ) {
    throwNoRightsError(err);
  }
};

// Auth only knows ADMIN/USER, so USER_ADMIN (synced to auth as ADMIN) must keep its role.
export const getTenantUserRoleFromAuth = (
  authRole: AuthGroupRole,
  role: TenantUserRole,
): TenantUserRole => {
  if (authRole === AuthGroupRole.ADMIN && role === TenantUserRole.USER) {
    return TenantUserRole.OWNER;
  }

  if (authRole === AuthGroupRole.USER && role === TenantUserRole.OWNER) {
    return TenantUserRole.USER;
  }

  return role;
};

export const isTimeBeforeReview = async (ctx: Context<any>, time: Date) => {

  const eventTime = time.getTime();
  if(isNaN(eventTime)) {
    throwValidationError(FishStockingErrorMessages.INVALID_EVENT_TIME);
  }
  const currentTime = new Date().getTime();
  const timeDiff = eventTime - currentTime;
  const settings: Setting = await ctx.call('settings.getSettings');

  return timeDiff >= (24*60*60*1000) * settings.minTimeTillFishStocking;
}

export const  validateFishData = async(ctx: Context<any>) => {
  //TODO: no duplicate fishTypes allowed

  // Validate batches fishType
  const fishTypesIds = ctx.params.batches.map((batch: {fishType: number}) => batch.fishType);
  const fishTypes: FishType[] = await ctx.call('fishTypes.find', {
    query: {
      id: {$in: fishTypesIds}
    }
  });

  if(fishTypesIds.length !== fishTypes.length) {
    throwValidationError(FishStockingErrorMessages.INVALID_FISH_TYPE);
  }

  // Validate batches fishAge
  const fishAgesIds = ctx.params.batches.reduce((data: Array<number>, current: {fishAge: number}) => {
    if(!data.includes(current.fishAge)) {
      data.push(current.fishAge);
    }
    return data;
  }, []);
  const fishAges: FishAge[] = await ctx.call('fishAges.find', {
    query: {
      id: {$in: fishAgesIds}
    }
  });
  if(fishAgesIds.length !== fishAges.length) {
    throwValidationError(FishStockingErrorMessages.INVALID_FISH_AGE);
  }
}

export const validateStockingCustomer = async(ctx: Context<any>) => {
  if(ctx.params.stockingCustomer) {
    const stockingCustomer = await ctx.call('tenants.get', {
      id: ctx.params.stockingCustomer,
    });
    if(!stockingCustomer) {
      throwValidationError(FishStockingErrorMessages.INVALID_STOCKING_CUSTOMER);
    }
  }
}


export const validateAssignedTo = async (ctx: Context<any, UserAuthMeta>) => {
  // If freelancer registration, then assignedTo is connected user.
  // If tenant registration, then assignedTo must be user of that tenant.
  if(ctx.meta.profile) {
    if(ctx.params.assignedTo) {
      const tenantUser = await ctx.call('tenantUsers.find', {
        user: ctx.params.assignedTo,
        tenant: ctx.meta.profile,
      });
      if(!tenantUser) {
        throwValidationError(FishStockingErrorMessages.INVALID_ASSIGNED_TO_ID);
      }
    } else {
      throwValidationError(FishStockingErrorMessages.ASSIGNED_TO_NOT_DEFINED);
    }
  } else {
    ctx.params.assignedTo = ctx.meta.user.id;
  }
}


export const validateFishOrigin = async (ctx: Context<any>, existingFishStocking?: FishStocking) => {
  if(ctx.params.fishOrigin || ctx.params.fishOriginReservoir || ctx.params.fishOriginCompanyName) {
    const fishOrigin = ctx.params.fishOrigin || existingFishStocking?.fishOrigin;
    const fishOriginReservoir = ctx.params.fishOriginReservoir || existingFishStocking?.fishOriginReservoir;
    const fishOriginCompanyName = ctx.params.fishOriginCompanyName || existingFishStocking?.fishOriginCompanyName;
    const fishCaughtInvalid = fishOrigin === FishOrigin.CAUGHT && !fishOriginReservoir?.name?.trim();
    const fishGrownInvalid = fishOrigin === FishOrigin.GROWN && !fishOriginCompanyName;
    if(fishCaughtInvalid || fishGrownInvalid) {
      throwValidationError(FishStockingErrorMessages.INVALID_FISH_ORIGIN);
    }

  }
}

export const canProfileModifyFishStocking = (ctx: Context<any, UserAuthMeta>, existingFishStocking: FishStocking) => {
  if(ctx.meta.profile) {
    const tenantUserCanModify = ctx.meta.profile == existingFishStocking.tenant;
    const stockingCustomerCanModify = ctx.meta.profile == existingFishStocking.stockingCustomer;
    if(!tenantUserCanModify && !stockingCustomerCanModify) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Invalid tenant profile',
      });
    }
  } else {
    const isFreelancer = ctx.meta.user.isFreelancer;
    const isTenantFishStocking = !!existingFishStocking.tenant;
    const canFreelancerModify = isFreelancer && !isTenantFishStocking &&  ctx.meta.user.id !== existingFishStocking.assignedTo;
    if(canFreelancerModify) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Invalid user profile',
      });
    }
  }
}

export const isManualLocation = (location?: { cadastral_id?: string }) => !location?.cadastral_id;

// Only hand-typed water bodies are checked here: a UETK one carries its own name
// and municipality, and older rows with an incomplete location must stay editable.
export const validateLocation = (location?: {
  cadastral_id?: string;
  name?: string;
  municipality?: { id?: number };
}) => {
  if (!location || !isManualLocation(location)) return;
  if (!location.name?.trim()) {
    throwValidationError(FishStockingErrorMessages.INVALID_LOCATION_NAME);
  }
  // the admin visibility scope filters on location.municipality.id
  if (!location.municipality?.id) {
    throwValidationError(FishStockingErrorMessages.INVALID_LOCATION_MUNICIPALITY);
  }
};

export const isCanceled = (fishStocking: FishStocking) => {
  return !!fishStocking.canceledAt;
};

export const isReviewed = (fishStocking: FishStocking, batches: FishBatch[]) => {
  const batchesDataNotFilled = batches?.some((batch: any) => batch.reviewAmount === null);
  return !batchesDataNotFilled;
};

// The review form pre-fills the assigned inspector's name/organization with an
// empty `signature`, so a non-empty array does not prove the inspector signed.
// Only an entry carrying an actual signature value counts.
const hasSignature = (fishStocking: FishStocking) =>
  Array.isArray(fishStocking.signatures) &&
  fishStocking.signatures.some((signature: any) => !isEmpty(signature?.signature));

export const isInspected = (fishStocking: FishStocking, batches: FishBatch[]) => {
  const reviewed = isReviewed(fishStocking, batches);
  // "Patikrinta" requires an assigned inspector (officer) who actually signed.
  return reviewed && !isEmpty(fishStocking.inspector) && hasSignature(fishStocking);
};

export const isOngoing = (fishStocking: FishStocking, settings: Setting) => {
  const eventTime = new Date(fishStocking.eventTime);
  const start = startOfDay(eventTime);
  const end = endOfDay(
      add(eventTime, {
        days: settings.maxTimeForRegistration,
      }),
  );
  const today = new Date();
  return isAfter(today, start) && isBefore(today, end);
};

export const isUpcoming = (fishStocking: FishStocking) => {
  const start = startOfDay(fishStocking.eventTime);
  return isBefore(new Date(), start);
};

export const isNotFinished = (fishStocking: FishStocking, settings: Setting) => {
  const eventTime = new Date(fishStocking.eventTime);
  const end = endOfDay(
      add(eventTime, {
        days: settings.maxTimeForRegistration,
      }),
  );
  return isAfter(new Date(), end);
};

export const getStatus = (ctx: Context, fishStocking: FishStocking, batches: FishBatch[], settings: Setting) => {
  if (isCanceled(fishStocking)) {
    return FishStockingStatus.CANCELED;
  } else if (isInspected(fishStocking, batches)) {
    return FishStockingStatus.INSPECTED;
  } else if (isReviewed(fishStocking, batches)) {
    return FishStockingStatus.FINISHED;
  } else if (isOngoing(fishStocking, settings)) {
    return FishStockingStatus.ONGOING;
  } else if (isUpcoming(fishStocking)) {
    return FishStockingStatus.UPCOMING;
  } else if (isNotFinished(fishStocking, settings)) {
    return FishStockingStatus.NOT_FINISHED;
  }
  return null;
}



