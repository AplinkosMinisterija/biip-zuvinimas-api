import moleculer, { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { TenantUserRole } from '../services/tenantUsers.service';
import {FishOrigin, FishStockingErrorMessages, FishStockingStatus, throwNoRightsError} from '../types';
import {Setting} from "../services/settings.service";
import {FishType} from "../services/fishTypes.service";
import {FishAge} from "../services/fishAges.service";
import {FishStocking} from "../services/fishStockings.service";
import ApiGateway from "moleculer-web";
import {FishBatch} from "../services/fishBatches.service";
import {isEmpty} from "lodash";
import {add, endOfDay, isAfter, isBefore, startOfDay, sub} from "date-fns";

export const validateCanManageTenantUser = (ctx: Context<any, UserAuthMeta>, err: string) => {
  const { profile } = ctx.meta;

  if (
    ctx.meta.authUser?.type === AuthUserRole.USER &&
    ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(ctx.meta.user.tenants[profile])
  ) {
    throwNoRightsError(err);
  }
};

export const isTimeBeforeReview = async (ctx: Context<any>, time: Date) => {

  const eventTime = time.getTime();
  if(isNaN(eventTime)) {
    throw new moleculer.Errors.ValidationError('Invalid event time');
  }
  const currentTime = new Date().getTime();
  const timeDiff = eventTime - currentTime;
  const settings: Setting = await ctx.call('settings.getSettings');

  return timeDiff >= (24*60*60*1000) * settings.minTimeTillFishStocking;
}

export const validateDeleteTime = async (ctx: Context<any>, fishStocking: FishStocking) => {
  const settings: Setting = await ctx.call('settings.getSettings');
  const minTime = settings.minTimeTillFishStocking;
  const maxPermittedTime = sub(fishStocking.eventTime, {
    days: minTime,
  });

  const validTime = isBefore(new Date(), maxPermittedTime);
  if (!validTime) {
    throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_DELETE_TIME);
  }
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
    throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_FISH_TYPE);
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
    throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_FISH_AGE);
  }
}

export const validateStockingCustomer = async(ctx: Context<any>) => {
  if(ctx.params.stockingCustomer) {
    const stockingCustomer = await ctx.call('tenants.get', {
      id: ctx.params.stockingCustomer,
    });
    if(!stockingCustomer) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_STOCKING_CUSTOMER);
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
        throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_ASSIGNED_TO_ID);
      }
    } else {
      throw new moleculer.Errors.ValidationError(
          FishStockingErrorMessages.ASSIGNED_TO_NOT_DEFINED
      );
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
    const fishCaughtInvalid = fishOrigin === FishOrigin.CAUGHT && !fishOriginReservoir;
    const fishGrownInvalid = fishOrigin === FishOrigin.GROWN && !fishOriginCompanyName;
    if(fishCaughtInvalid || fishGrownInvalid) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_FISH_ORIGIN);
    }

  }
}

export const canProfileModifyFishStocking = (ctx: Context<any, UserAuthMeta>, existingFishStocking: FishStocking) => {
  if(ctx.meta.profile) {
    const tenantUserCanModify = ctx.meta.profile === existingFishStocking.tenant;
    const stockingCustomerCanModify = ctx.meta.profile == existingFishStocking.stockingCustomer;
    if(!tenantUserCanModify && !stockingCustomerCanModify) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'NoMunicipalityPermission',
      });
    }
  } else {
    const isFreelancer = ctx.meta.user.isFreelancer;
    const isTenantFishStocking = !!existingFishStocking.tenant;
    const canFreelancerModify = isFreelancer && !isTenantFishStocking &&  ctx.meta.user.id !== existingFishStocking.assignedTo;
    if(canFreelancerModify) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'NoMunicipalityPermission',
      });
    }
  }
}

export const isCanceled = (fishStocking: any) => {
  return !!fishStocking.canceledAt;
};

export const isReviewed = (fishStocking: any, batches: FishBatch[]) => {
  const batchesDataNotFilled = batches?.some((batch: any) => batch.reviewAmount === null);
  return !batchesDataNotFilled;
};

export const isInspected = (fishStocking: FishStocking, batches: FishBatch[]) => {
  const reviewed = isReviewed(fishStocking, batches);
  return reviewed && !isEmpty(fishStocking.signatures);
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



