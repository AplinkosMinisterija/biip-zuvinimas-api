'use strict';

import { isEmpty, map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import ApiGateway from 'moleculer-web';
import XLSX from 'xlsx';
import DbConnection from '../mixins/database.mixin';
import GeometriesMixin from '../mixins/geometries.mixin';
import { GeomFeatureCollection, coordinatesToGeometry, geometryToGeom } from '../modules/geometry';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  EntityChangedParams,
  FieldHookCallback,
  FishOrigin,
  FishStockingErrorMessages,
  FishStockingStatus,
  RestrictionType,
  StatusLabels,
  Table,
} from '../types';
import {
  canProfileModifyFishStocking,
  getStatus,
  isTimeBeforeReview,
  validateAssignedTo,
  validateFishData,
  validateFishOrigin,
  validateStockingCustomer,
} from '../utils/functions';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { FishBatch } from './fishBatches.service';
import { FishStockingPhoto } from './fishStockingPhotos.service';
import { FishType } from './fishTypes.service';
import { Location } from './locations.service';
import { Setting } from './settings.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

const Readable = require('stream').Readable;

const BATCH_DATA_EXISTS_QUERY =
  'EXISTS (SELECT 1 FROM fish_batches fb WHERE fb.fish_stocking_id = fish_stockings.id AND fb.review_amount IS NOT NULL AND fb.deleted_at is NULL)';

const getStatusQueries = (maxTime: number) => ({
  [FishStockingStatus.CANCELED]: `canceled_at IS NOT NULL`,
  [FishStockingStatus.INSPECTED]: `signatures IS NOT NULL AND ${BATCH_DATA_EXISTS_QUERY}`,
  [FishStockingStatus.FINISHED]: `signatures IS NULL AND ${BATCH_DATA_EXISTS_QUERY}`,
  [FishStockingStatus.ONGOING]: `NOW() < date_trunc('day',event_time + '00:00:00') + INTERVAL '${maxTime} days' AND NOW() > date_trunc('day',event_time + '00:00:00') AND NOT ${BATCH_DATA_EXISTS_QUERY} AND canceled_at is NULL`,
  [FishStockingStatus.UPCOMING]: `NOW() < date_trunc('day',event_time + '00:00:00') AND NOT ${BATCH_DATA_EXISTS_QUERY} AND canceled_at is NULL`,
  [FishStockingStatus.NOT_FINISHED]: `NOW() > date_trunc('day',event_time + '00:00:00') + INTERVAL '10 days' AND NOT ${BATCH_DATA_EXISTS_QUERY} AND canceled_at is NULL`,
});

interface Fields extends CommonFields {
  id: number;
  eventTime: Date;
  comment?: string;
  tenant?: Tenant['id'];
  stockingCustomer?: Tenant['id'];
  fishOrigin: string;
  fishOriginCompanyName?: string;
  fishOriginReservoir?: {
    area: number;
    cadastral_id: string;
    name: string;
    municipality: {
      id: number;
      name: string;
    };
  };
  location: Location;
  geom: any;
  batches: Array<FishBatch['id']>;
  assignedTo: User['id'];
  phone: string;
  reviewedBy?: User['id'];
  reviewLocation?: { lat: number; lng: number };
  reviewTime?: Date;
  waybillNo?: string;
  veterinaryApprovalNo?: string;
  veterinaryApprovalOrderNo?: string;
  containerWaterTemp?: number;
  waterTemp?: number;
  images?: FishStockingPhoto['id'];
  signatures?: Array<{
    organization: string;
    signedBy: string;
    signature: string;
  }>;
  assignedToInspector?: number;
  inspector?: any;
  canceledAt: Date;
  mandatory?: boolean;
  coordinates?: any;
  oldId: number;
  fishTypes: any;
  status: FishStockingStatus;
}

interface Populates extends CommonPopulates {
  tenant: Tenant;
  stockingCustomer: Tenant;
  assignedTo: User;
  assignedToInspector: User;
  reviewedBy: User;
  batches: Array<FishBatch>;
  status: FishStockingStatus;
  geom: any;
}

export type FishStocking<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishStockings',
  mixins: [
    DbConnection({
      createActions: {
        create: false,
      },
    }),
    GeometriesMixin,
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      eventTime: 'string|required',
      comment: 'string',
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        required: false,
        populate: {
          action: 'tenants.resolve',
        },
        onCreate: ({ ctx }: FieldHookCallback) => ctx?.meta?.profile,
      },
      stockingCustomer: {
        type: 'number',
        columnType: 'integer',
        columnName: 'stockingCustomerId',
        required: false,
        populate: {
          action: 'tenants.resolve',
        },
      },
      fishOrigin: { type: 'enum', values: Object.values(FishOrigin), required: true },
      fishOriginCompanyName: 'string',
      fishOriginReservoir: {
        type: 'object',
        required: false,
        raw: true,
        properties: {
          area: 'number',
          name: 'string',
          cadastral_id: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
        },
      },
      location: {
        type: 'object',
        raw: true,
        required: false,
        properties: {
          cadastral_id: 'string',
          name: 'string',
          municipality: 'object',
          area: 'number|optional',
          length: 'number|optional',
          category: 'string',
        },
      },
      geom: {
        type: 'any',
        raw: true,
        populate(ctx: any, _values: any, fishStockings: FishStocking[]) {
          return Promise.all(
            fishStockings.map((fishStocking) => {
              return ctx.call('fishStockings.getGeometryJson', {
                id: fishStocking.id,
              });
            }),
          );
        },
      },
      coordinates: {
        type: 'any',
        virtual: true,
        hidden: 'byDefault',
        get: async ({ entity, ctx }: FieldHookCallback) => {
          return ctx.call('fishStockings.getWgsCoordinates', {
            id: entity.id,
          });
        },
      },
      batches: {
        // TODO: could be actual jsonb field instead of batches table. This would make selection and updates much easier.
        type: 'array',
        readonly: false,
        required: true,
        virtual: true,
        default: () => [],
        async populate(ctx: Context, _values: any, fishStockings: FishStocking[]) {
          const fishBatches: FishBatch[] = await ctx.call('fishBatches.find', {
            query: {
              fishStocking: {
                $in: fishStockings.map((fishStocking: FishStocking) => fishStocking.id),
              },
            },
            populate: ['fishType', 'fishAge'],
          });

          const batchesByStocking: Record<FishStocking['id'], FishBatch[]> = {};

          fishBatches.forEach((fishBatch) => {
            batchesByStocking[fishBatch.fishStocking] ??= [];
            batchesByStocking[fishBatch.fishStocking].push(fishBatch);
          });

          return fishStockings.map((fishStocking) => batchesByStocking[fishStocking.id]);
        },
      },
      assignedTo: {
        type: 'number',
        columnType: 'integer',
        columnName: 'assignedToId',
        required: false,
        populate: {
          action: 'users.resolve',
        },
      },
      phone: {
        type: 'string',
        required: false,
      },
      reviewedBy: {
        type: 'number',
        columnType: 'integer',
        columnName: 'reviewedById',
        required: false,
        populate: {
          action: 'users.resolve',
        },
      },
      reviewLocation: {
        type: 'any',
        raw: true,
        populate(ctx: any, _values: any, fishStockings: FishStocking[]) {
          return Promise.all(
            fishStockings.map((fishStocking) => {
              return ctx.call('fishStockings.getGeometryJson', {
                field: 'reviewLocation',
                asField: 'reviewLocation',
                id: fishStocking.id,
              });
            }),
          );
        },
      },
      reviewTime: 'date',
      waybillNo: 'string',
      veterinaryApprovalNo: 'string',
      veterinaryApprovalOrderNo: 'string',
      containerWaterTemp: 'number',
      waterTemp: 'number',
      images: {
        type: 'array',
        readonly: true,
        required: true,
        virtual: true,
        default: () => [],
        async populate(ctx: Context, _values: any, fishStockings: FishStocking[]) {
          return await Promise.all(
            fishStockings.map(async (fishStocking) =>
              ctx.call('fishStockingPhotos.find', {
                query: {
                  fishStocking: fishStocking.id,
                  // tenant: { $in: Object.keys(user.tenants)
                },
              }),
            ),
          );
        },
      },
      signatures: {
        type: 'array',
        required: false,
        items: {
          type: 'object',
          properties: {
            signedBy: 'string',
            signature: 'string',
            organization: 'string',
          },
        },
      },
      assignedToInspector: {
        type: 'number',
        columnType: 'integer',
        columnName: 'assignedToInspectorId',
        required: false,
        async populate(ctx: Context, _values: any, fishStockings: FishStocking[]) {
          return await Promise.all(
            fishStockings.map(async (fishStocking: any) => {
              if (!fishStocking.assignedToInspectorId) {
                return null;
              }
              try {
                const authUser = await ctx.call('auth.users.get', {
                  id: fishStocking.assignedToInspectorId,
                  scope: false,
                });
                return authUser;
              } catch (e) {
                return null;
              }
            }),
          );
        },
      },
      inspector: {
        type: 'object',
        required: false,
        properties: {
          firstName: 'string',
          lastName: 'string',
          id: 'number',
          email: 'string|optional',
          phone: {
            type: 'string',
            required: true,
          },
          organization: 'string',
        },
      },
      status: {
        type: 'string',
        readonly: true,
        required: true,
        virtual: true,
        default: () => [],
        async populate(ctx: Context, _values: any, fishStockings: FishStocking[]) {
          const fishBatches: FishBatch[] = await ctx.call('fishBatches.find', {
            query: {
              fishStocking: {
                $in: fishStockings.map((fishStocking: FishStocking) => fishStocking.id),
              },
            },
          });

          const batchesByStocking: Record<FishStocking['id'], FishBatch[]> = {};

          fishBatches.forEach((fishBatch) => {
            batchesByStocking[fishBatch.fishStocking] ??= [];
            batchesByStocking[fishBatch.fishStocking].push(fishBatch);
          });

          const settings: Setting = await ctx.call('settings.getSettings');
          return fishStockings.map((fishStocking) =>
            getStatus(ctx, fishStocking, batchesByStocking[fishStocking.id], settings),
          );
        },
      },
      mandatory: {
        virtual: true,
        readonly: true,
        default: () => [],
        async populate(ctx: Context, _values: any, fishStockings: FishStocking[]) {
          return await Promise.all(
            fishStockings.map(async (entity) => {
              const area = entity.location.area;
              if (area && area > 50) {
                return true;
              }
              const mandatoryLocation = await ctx.call('mandatoryLocations.findOne', {
                filter: {
                  cadastral_id: entity.location.cadastral_id,
                },
              });
              return !!mandatoryLocation;
            }),
          );
        },
      },
      canceledAt: 'string',
      oldId: 'number',
      fishTypes: { type: 'object', default: {}, hidden: 'byDefault' },
      ...COMMON_FIELDS,
    },
    scopes: {
      profile(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        if (ctx.meta) {
          // adminai
          if (
            !ctx.meta.user &&
            ctx.meta.authUser &&
            (ctx.meta.authUser.type === AuthUserRole.ADMIN ||
              ctx.meta.authUser.type === AuthUserRole.SUPER_ADMIN)
          ) {
            if (isEmpty(ctx.meta.authUser.municipalities)) {
              throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
                error: 'NoMunicipalityPermission',
              });
            }
            return {
              ...query,
              $raw: `("location"::jsonb->'municipality'->'id')::int in (${ctx.meta.authUser.municipalities?.toString()})`,
            };
          }
          // sesijoj imone
          if (ctx.meta.profile && ctx.meta?.user) {
            return {
              ...query,
              $raw: `(tenant_id = ${ctx.meta.profile} OR stocking_customer_id = ${ctx.meta.profile})`,
            };
          }

          // sesijoj freelancer
          if (!ctx.meta.profile && ctx.meta?.user) {
            return {
              ...query,
              createdBy: ctx.meta.user.id,
              tenant: { $exists: false },
            };
          }
        }
        return query;
      },
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'profile'],
    defaultPopulates: ['batches', 'status', 'mandatory'],
  },
  hooks: {
    before: {
      create: ['parseGeomField', 'parseReviewLocationField'],
      updateRegistration: ['parseGeomField'],
      register: ['parseGeomField'],
      review: ['parseReviewLocationField'],
      list: ['beforeSelect', 'handleSort'],
      find: ['beforeSelect', 'handleSort'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect', 'handleSort'],
      export: ['beforeSelect', 'handleSort'],
    },
  },
  actions: {
    remove: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      rest: null,
    },
  },
})
export default class FishStockingsService extends moleculer.Service {
  @Action({
    rest: 'PATCH /:id',
    auth: RestrictionType.ADMIN,
    params: {
      eventTime: 'string|optional',
      comment: 'string|optional',
      tenant: 'number|optional',
      stockingCustomer: 'number|optional',
      fishOrigin: { type: 'enum', values: Object.values(FishOrigin), optional: true },
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: {
        type: 'object',
        optional: true,
        properties: {
          area: 'number',
          name: 'string',
          cadastral_id: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
        },
      },
      location: 'object|optional',
      geom: 'any|optional',
      batches: {
        type: 'array',
        optional: true,
        min: 1,
        items: {
          type: 'object',
          properties: {
            id: 'number|optional',
            fishType: 'number|integer|positive|convert',
            fishAge: 'number|integer|positive|convert',
            amount: 'number|integer|positive|convert',
            weight: 'number|optional|convert',
            reviewAmount: 'number|integer|positive|optional|convert',
            reviewWeight: 'number|optional|convert',
          },
        },
      },
      assignedTo: 'number|optional',
      phone: {
        // TODO: freelancer might not have phone number and currently it is not required for freelancer to enter phone number in FishStocking registration form.
        type: 'string',
        optional: true,
      },
      waybillNo: 'string|optional',
      veterinaryApprovalNo: 'string|optional',
      veterinaryApprovalOrderNo: 'string|optional',
      containerWaterTemp: 'number|optional',
      waterTemp: 'number|optional',
      signatures: {
        type: 'array',
        optional: true,
        items: {
          type: 'object',
          properties: {
            signedBy: 'string',
            signature: 'string|base64',
          },
        },
      },
      inspector: 'number|optional',
      canceledAt: 'string|optional',
    },
  })
  async updateFishStocking(ctx: Context<any, UserAuthMeta>) {
    const existingFishStocking: FishStocking = await this.resolveEntities(ctx, {
      id: ctx.params.id,
      populate: 'status',
    });
    // Validate tenant
    if (ctx.params.tenant) {
      await ctx.call('tenants.resolve', { id: ctx.params.tenant, throwIfNotExist: true });
    }
    // Validate stockingCustomer
    if (ctx.params.stockingCustomer) {
      const stockingCustomer = await ctx.call('tenants.get', { id: ctx.params.stockingCustomer });
      if (!stockingCustomer) {
        throw new moleculer.Errors.ValidationError('Invalid stocking customer');
      }
    }

    // Validate fishType & fishAge
    if (ctx.params.batches) {
      await validateFishData(ctx);
    }

    // Validate assignedTo
    if (ctx.params.assignedTo) {
      const tenant = ctx.params.tenant || existingFishStocking.tenant;
      if (tenant) {
        // Tenant fish stocking
        const tenantUser = await ctx.call('tenantUsers.findOne', {
          query: {
            tenant,
            user: ctx.params.assignedTo,
          },
        });
        if (!tenantUser) {
          throw new moleculer.Errors.ValidationError('Invalid "assignedTo" id');
        }
      } else {
        // Freelancers fish stocking
        const user: User = await ctx.call('users.get', {
          id: ctx.params.assignedTo,
        });
        //if user does not exist or is not freelancer
        if (!user || !user.isFreelancer) {
          throw new moleculer.Errors.ValidationError('Invalid "assignedTo" id');
        }
      }
    }

    // Validate canceledAt time
    if (ctx.params.canceledAt) {
      const eventTime: Date =
        (ctx.params.eventTime && new Date(ctx.params.eventTime)) || existingFishStocking.eventTime;
      const canceledAtTime = new Date(ctx.params.canceledAt);
      if (eventTime.getTime() - canceledAtTime.getTime() <= 0) {
        throw new moleculer.Errors.ValidationError('Invalid "canceledAt" time');
      }
    }

    // Validate fishOrigin
    await validateFishOrigin(ctx, existingFishStocking);

    // Admin can add, remove or update batches
    if (ctx.params.batches) {
      await ctx.call('fishBatches.updateBatches', {
        batches: ctx.params.batches,
        fishStocking: Number(ctx.params.id),
      });
    }

    const fishStockingBeforeUpdate = await this.resolveEntities(ctx);
    if (ctx.params.inspector) {
      const inspector: any = await ctx.call('auth.users.get', {
        id: ctx.params.inspector,
      });
      // Validate inspector
      if (!inspector) {
        throw new moleculer.Errors.ValidationError('Invalid inspector id');
      }
      const fishStocking = await this.updateEntity(ctx, {
        ...ctx.params,
        inspector: {
          id: inspector.id,
          firstName: inspector.firstName,
          lastName: inspector.lastName,
          email: inspector.email,
          phone: inspector.phone,
          organization: 'AAD',
        },
      });

      if (fishStockingBeforeUpdate.inspector?.id !== ctx.params.inspector) {
        if (inspector) {
          await ctx.call('mail.sendFishStockingAssignedEmail', {
            email: inspector.email,
            fishStocking,
          });
        }
      }
      return fishStocking;
    }

    return await this.updateEntity(ctx);
  }

  @Action({
    rest: 'PATCH /cancel/:id',
    auth: RestrictionType.USER,
  })
  async cancel(ctx: Context<any, UserAuthMeta>) {
    const fishStocking = await this.resolveEntities(ctx, {
      id: ctx.params.id,
      populate: ['status'],
    });

    if (!fishStocking) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_ID);
    }

    // Validate if user can cancel fishStocking
    canProfileModifyFishStocking(ctx, fishStocking);
    if (
      fishStocking.status !== FishStockingStatus.UPCOMING &&
      fishStocking.status !== FishStockingStatus.ONGOING &&
      fishStocking.status !== FishStockingStatus.NOT_FINISHED
    ) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_STATUS);
    }

    //if fish stocking is still in upcoming state, then it can be deleted.
    if (fishStocking.status === FishStockingStatus.UPCOMING) {
      return this.removeEntity(ctx, { id: fishStocking.id });
    }
    //else it should be canceled
    return this.updateEntity(ctx, {
      id: ctx.params.id,
      canceledAt: new Date().toDateString(),
    });
  }

  @Action({
    rest: 'POST /register',
    auth: RestrictionType.USER,
    cache: false,
    params: {
      eventTime: 'string',
      phone: {
        // TODO: freelancer might not have phone number and currently it is not required for freelancer to enter phone number in FishStocking registration form.
        type: 'string',
        optional: true,
      },
      assignedTo: 'number|integer|convert',
      location: {
        type: 'object',
        properties: {
          cadastral_id: 'string',
          name: 'string',
          municipality: 'object',
          area: 'number|optional|convert',
          length: 'number|optional|convert',
          category: 'string',
        },
      },
      geom: 'any',
      batches: {
        type: 'array',
        optional: false,
        min: 1,
        items: {
          type: 'object',
          properties: {
            fishType: 'number|integer|positive|convert',
            fishAge: 'number|integer|positive|convert',
            amount: 'number|integer|positive|convert',
            weight: 'number|positive|optional|convert',
          },
        },
      },
      fishOrigin: { type: 'enum', values: Object.values(FishOrigin) },
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: {
        type: 'object',
        optional: true,
        properties: {
          name: 'string',
          cadastral_id: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
          area: 'number|optional',
        },
      },
      tenant: 'number|integer|optional|optional',
      stockingCustomer: 'number|integer|optional|convert',
    },
  })
  async register(ctx: Context<any, UserAuthMeta>) {
    // Validate eventTime
    const timeBeforeReview = await isTimeBeforeReview(ctx, new Date(ctx.params.eventTime));
    if (!timeBeforeReview) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_EVENT_TIME);
    }

    // Validate assignedTo
    await validateAssignedTo(ctx);

    // Validate fishType & fishAge
    await validateFishData(ctx);

    // Validate stocking customer
    await validateStockingCustomer(ctx);

    // Validate fishOrigin
    await validateFishOrigin(ctx);

    // Assign tenant if necessary
    ctx.params.tenant = ctx.meta.profile;

    const fishStocking: FishStocking = await this.createEntity(ctx, ctx.params);

    try {
      await ctx.call('fishBatches.createBatches', {
        batches: ctx.params.batches,
        fishStocking: fishStocking.id,
      });
    } catch (e) {
      await this.removeEntity(ctx, { id: fishStocking.id });
      throw e;
    }

    // Send email to notify about new fish stocking
    const users: any = await ctx.call('auth.permissions.getUsersByAccess', {
      access: 'FISH_STOCKING_EMAILS',
      data: {
        municipality: fishStocking.location.municipality.id,
      },
    });
    const emailsToNotify: Array<string> = users?.rows?.map((i: any) => i.email) || [];
    if (emailsToNotify.length) {
      await ctx.call('mail.sendFishStockingUpdateEmail', {
        emails: emailsToNotify,
        fishStocking,
        update: false,
      });
    }
    return this.resolveEntities(ctx, { id: fishStocking.id, populate: ['status', 'batches'] });
  }

  @Action({
    rest: 'PATCH /register/:id',
    auth: RestrictionType.USER,
    cache: false,
    params: {
      id: 'number|convert',
      eventTime: 'string',
      phone: {
        // TODO: freelancer might not have phone number and currently it is not required for freelancer to enter phone number in FishStocking registration form.
        type: 'string',
        optional: true,
      },
      assignedTo: {
        type: 'number',
        columnType: 'integer',
        columnName: 'assignedToId',
        optional: true,
        populate: {
          action: 'users.resolve',
        },
      },
      geom: 'any',
      location: {
        type: 'object',
        raw: true,
        properties: {
          cadastral_id: 'string',
          name: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
          area: 'number|optional|convert',
          length: 'number|optional|convert',
          category: 'string',
        },
      },
      batches: {
        type: 'array',
        optional: true,
        items: {
          type: 'object',
          min: 1,
          properties: {
            id: 'number|optional|convert',
            fishType: 'number|convert',
            fishAge: 'number|convert',
            amount: 'number|convert',
            weight: 'number|optional',
          },
        },
      },
      fishOrigin: 'string',
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: {
        type: 'object',
        optional: true,
        properties: {
          area: 'number',
          name: 'string',
          cadastral_id: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
        },
      },
      tenant: 'number|optional',
      stockingCustomer: 'number|optional',
    },
  })
  async updateRegistration(ctx: Context<any, UserAuthMeta>) {
    const existingFishStocking: FishStocking = await this.resolveEntities(ctx, {
      id: ctx.params.id,
      populate: 'status',
    });
    if (!existingFishStocking) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_ID);
    }
    // Validate fish stocking status
    if (
      ![FishStockingStatus.UPCOMING, FishStockingStatus.ONGOING].some(
        (status) => status === existingFishStocking.status,
      )
    ) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_STATUS);
    }
    //Validate if user can edit fishStocking
    canProfileModifyFishStocking(ctx, existingFishStocking);
    // Validate assignedTo
    const assignedToChanged =
      !!ctx.params.assignedTo && ctx.params.assignedTo !== existingFishStocking.assignedTo;
    await validateAssignedTo(ctx);
    // If existing fish stocking time is within the time interval indicating that it is time to review fish stocking,
    // then most of the data cannot be edited except assignedTo.
    if (existingFishStocking.status === FishStockingStatus.ONGOING) {
      if (assignedToChanged) {
        try {
          return this.updateEntity(ctx, { assignedTo: ctx.params.assignedTo });
        } catch (e) {
          throw new moleculer.Errors.ValidationError('Could not update fishStocking');
        }
      }
    }
    if (existingFishStocking.status === FishStockingStatus.UPCOMING) {
      // Validate event time
      if (ctx.params.eventTime) {
        const timeBeforeReview = await isTimeBeforeReview(ctx, new Date(ctx.params.eventTime));
        if (!timeBeforeReview) {
          throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_EVENT_TIME);
        }
      }
      // Validate fishType & fishAge
      if (ctx.params.batches) {
        await validateFishData(ctx);
      }
      // Validate stocking customer
      await validateStockingCustomer(ctx);

      await this.updateEntity(ctx);

      //if fish stocking is not finished yet, user can add, remove and update batches.
      await ctx.call('fishBatches.updateRegisteredBatches', {
        batches: ctx.params.batches,
        fishStocking: ctx.params.id,
      });
    }

    return this.resolveEntities(ctx, {
      id: existingFishStocking.id,
      populate: 'batches',
    });
  }

  @Action({
    rest: 'POST /review',
    auth: RestrictionType.USER,
    cache: false,
    params: {
      id: 'number',
      reviewLocation: 'any|optional',
      waybillNo: 'string',
      veterinaryApprovalNo: 'string',
      veterinaryApprovalOrderNo: 'string|optional',
      containerWaterTemp: 'number',
      waterTemp: 'number',
      batches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: 'number|integer|positive|convert',
            reviewAmount: 'number|integer|positive|convert',
            reviewWeight: 'number|optional|convert',
          },
        },
      },
      signatures: 'any|optional',
      comment: 'string|optional',
    },
  })
  //only for user
  async review(
    ctx: Context<
      {
        id: number;
        reviewLocation?: any;
        waybillNo?: string;
        veterinaryApprovalNo?: string;
        veterinaryApprovalOrderNo?: string;
        containerWaterTemp?: number;
        waterTemp?: number;
        batches: Array<{
          id: number;
          reviewAmount: number;
          reviewWeight?: number;
        }>;
        signatures?: Array<{
          signedBy: number;
          signature: string;
          organization: string;
        }>;
        comment: string;
      },
      UserAuthMeta
    >,
  ) {
    const existingFishStocking: FishStocking = await this.resolveEntities(ctx, {
      id: ctx.params.id,
      populate: 'status',
    });

    if (!existingFishStocking) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_ID);
    }

    // Validate if user can review
    canProfileModifyFishStocking(ctx, existingFishStocking);

    // Validate if fishStocking status, it must be ONGOING.
    if (existingFishStocking.status !== FishStockingStatus.ONGOING) {
      throw new moleculer.Errors.ValidationError(FishStockingErrorMessages.INVALID_STATUS);
    }

    // if fishStocking is ONGOING, user can update fishBatches review data.
    await ctx.call('fishBatches.reviewBatches', {
      batches: ctx.params.batches,
      fishStocking: ctx.params.id,
    });

    await this.updateEntity(ctx, {
      ...ctx.params,
      reviewedBy: ctx.meta.user.id,
      reviewTime: new Date(),
    });

    return this.resolveEntities(ctx, {
      id: ctx.params.id,
      populate: ['batches', 'images'],
    });
  }

  @Action({
    rest: 'GET /recentLocations',
    auth: RestrictionType.USER,
  })
  async getRecentLocations(ctx: Context<any, UserAuthMeta>) {
    return await ctx.call('recentLocations.list');
  }

  @Action()
  async getLocationsCount(ctx: Context<any>) {
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    let response = await knex.raw(
      `SELECT COUNT(*) FROM (select distinct ("location"::jsonb->'cadastral_id') from "fish_stockings" GROUP BY "location") c`,
    );
    return Number(response.rows[0].count);
  }
  @Action()
  async getFishCount(ctx: Context<any>) {
    const adapter = await this.getAdapter(ctx);
    const queries = getStatusQueries(0);
    const knex = adapter.client;
    let response = await knex.raw(
      `select sum(fish_batches.review_amount) from "fish_batches", "fish_stockings" WHERE fish_batches.fish_stocking_id = fish_stockings.id AND (${
        queries[FishStockingStatus.FINISHED]
      } OR ${queries[FishStockingStatus.INSPECTED]})`,
    );
    return Number(response.rows[0].sum);
  }

  @Action({
    rest: 'GET /export',
  })
  async export(ctx: Context<any>) {
    //TODO: missing validations
    const data: any = await ctx.call('fishStockings.find', {
      ...ctx.params,
      populate: ['assignedTo', 'reviewedBy', 'batches', 'status'],
    });
    const mappedData: any[] = [];
    data.map((fishStocking: FishStocking<'reviewedBy' | 'assignedTo' | 'batches'>) => {
      const fishOrigin =
        fishStocking.fishOrigin === 'GROWN'
          ? fishStocking?.fishOriginCompanyName
          : fishStocking?.fishOriginReservoir;
      const date = fishStocking?.eventTime || '-';
      const municipality = fishStocking.location.municipality?.name || '-';
      const category = fishStocking.location.category || '-';
      const waterBodyName = fishStocking.location?.name || '-';
      const waterBodyCode = fishStocking.location.cadastral_id || '-';
      const waybillNo = fishStocking.waybillNo || '-';
      const assignedTo =
        fishStocking.reviewedBy?.fullName || fishStocking.assignedTo?.fullName || '-';
      const veterinaryApprovalNo = fishStocking?.veterinaryApprovalNo || '-';
      const status = fishStocking.status;
      for (const batch of fishStocking.batches || []) {
        mappedData.push({
          'Įveisimo data': date,
          Rajonas: municipality,
          'Vandens telkinio pavadinimas': waterBodyName,
          'Telkinio kodas': waterBodyCode,
          'Telkinio kategorija': category,
          'Žuvų, vėžių rūšis': batch.fishType?.label,
          Amžius: batch.fishAge?.label,
          'Planuojamas kiekis, vnt': batch.amount || 0,
          'Kiekis, vnt.': batch.reviewAmount || 0,
          'Planuojamas svoris, kg': batch.weight || 0,
          'Svoris, kg': batch.reviewWeight || 0,
          'Žuvys išaugintos': fishOrigin,
          'Važtaraščio nr.': waybillNo || '',
          'Atsakingas asmuo': assignedTo || '',
          'Veterinarinio pažymėjimo Nr.': veterinaryApprovalNo || '',
          Būsena: StatusLabels[status],
        });
      }
    });

    const workbook = XLSX.utils.book_new();

    const worksheet = XLSX.utils.json_to_sheet(mappedData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'žuvinimai');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    ctx.meta = {
      ...ctx.meta,
      $responseHeaders: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': 'attachment; filename="zuvinimai.xlsx"',
      },
    };
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
  }

  @Action()
  async getAll(ctx: Context) {
    return this.findEntities(ctx, ctx.params);
  }

  @Method
  async parseGeomField(
    ctx: Context<{
      id?: number;
      geom?: GeomFeatureCollection;
    }>,
  ) {
    const { geom, id } = ctx.params;

    if (geom?.features?.length) {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();
      try {
        const geomItem = geom.features[0];
        const value = geometryToGeom(geomItem.geometry);
        ctx.params.geom = table.client.raw(`ST_GeomFromText(${value},3346)`);
      } catch (err) {
        throw new moleculer.Errors.ValidationError(err.message);
      }
    } else if (id) {
      const fishStocking: FishStocking = await ctx.call('fishStockings.resolve', { id });
      if (!fishStocking.geom) {
        throw new moleculer.Errors.ValidationError('No geometry');
      }
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }
    return ctx;
  }

  @Method
  async parseReviewLocationField(
    ctx: Context<{
      id?: number;
      reviewLocation?: { lat: number; lng: number };
    }>,
  ) {
    const { reviewLocation } = ctx.params;

    if (isEmpty(reviewLocation)) {
      ctx.params.reviewLocation = null;
      return ctx;
    }

    const reviewLocationGeom: any = coordinatesToGeometry({
      x: reviewLocation.lng,
      y: reviewLocation.lat,
    });
    if (reviewLocationGeom?.features?.length) {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();
      try {
        const geomItem = reviewLocationGeom.features[0];
        const value = geometryToGeom(geomItem.geometry);
        ctx.params.reviewLocation = table.client.raw(`ST_GeomFromText(${value},3346)`);
      } catch (err) {
        throw new moleculer.Errors.ValidationError(err.message);
      }
    }
    return ctx;
  }

  @Method
  async beforeSelect(ctx: Context<any, UserAuthMeta>) {
    let query = {
      ...ctx.params.query,
    };
    let filters;

    if (ctx.params.filter) {
      filters =
        typeof ctx.params.filter === 'string' ? JSON.parse(ctx.params.filter) : ctx.params.filter;

      if (filters.fishTypes) {
        const filter = filters.fishTypes;
        query.$raw = {
          condition:
            (query?.$raw ? query.$raw.condition + ' AND ' : '') +
            `EXISTS (SELECT 1 FROM jsonb_each("fish_types") AS ft WHERE ft.value::int IN (${filter}))`,
        };
      }

      if (filters.inspector) {
        const filter = Number(filters.inspector);
        if (query.$raw) {
          query.$raw.condition += ` AND ("inspector"::jsonb->'id')::int = ${filter}`;
        } else {
          query.$raw = {
            condition: `("inspector"::jsonb->'id')::int = ${filter}`,
          };
        }
        filters.inspector = undefined;
      }
      if (filters.locationName) {
        const filter = filters.locationName;
        if (query.$raw) {
          query.$raw.condition += ` AND "location"::jsonb->>'name' ilike '%${filter}%'`;
        } else {
          query.$raw = {
            condition: `"location"::jsonb->>'name' ilike '%${filter}%'`,
          };
        }
      }
      if (filters.municipality) {
        const filter = filters.municipality;
        if (query.$raw) {
          query.$raw.condition += ` AND "location"::jsonb->'municipality'->>'name' ilike '%${filter}%'`;
        } else {
          query.$raw = {
            condition: `"location"::jsonb->'municipality'->>'name' ilike '%${filter}%'`,
          };
        }
      }
      if (filters.municipalityId) {
        const filter = filters.municipalityId;
        if (query.$raw) {
          query.$raw.condition += ` AND "location"::jsonb->'municipality'@> '{"id":${filter}}'`;
        } else {
          query.$raw = {
            condition: `"location"::jsonb->'municipality'@> '{"id":${filter}}'`,
          };
        }
      }
      if (filters.status) {
        const settings: Setting = await ctx.call('settings.getSettings');

        const statusQueries: any = getStatusQueries(settings.maxTimeForRegistration);

        let conditions = '';
        map(filters.status, (status) => {
          const q = statusQueries[status];
          if (!q) {
            return;
          }
          if (conditions) {
            conditions += ` OR (${q})`;
          } else {
            conditions += `(${q})`;
          }
        });

        if (query.$raw) {
          query.$raw.condition += ` AND (${conditions})`;
        } else {
          query.$raw = { condition: `(${conditions})` };
        }
      }
    }
    ctx.params.query = query;
    ctx.params.filter = filters;
    return ctx;
  }

  @Method
  async handleSort(ctx: Context<any, UserAuthMeta>) {
    ctx.params = {
      sort: '-eventTime',
      ...ctx.params,
    };
    return ctx;
  }

  @Method
  async handleProfile(q: object, ctx: Context<any, UserAuthMeta>) {
    if (ctx.meta) {
      // adminai
      if (
        !ctx.meta.user &&
        ctx.meta.authUser &&
        (ctx.meta.authUser.type === AuthUserRole.ADMIN ||
          ctx.meta.authUser.type === AuthUserRole.SUPER_ADMIN)
      ) {
        if (isEmpty(ctx.meta.authUser.municipalities)) {
          throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
            error: 'NoMunicipalityPermission',
          });
        }
        return {
          ...q,
          $raw: {
            condition: `("location"::jsonb->'municipality'->'id')::int in (${ctx.meta.authUser.municipalities?.toString()})`,
          },
        };
      }
      // sesijoj imone
      if (ctx.meta.profile && ctx.meta?.user) {
        return {
          ...q,
          $raw: {
            condition: `(tenant_id = ${ctx.meta.profile} OR stocking_customer_id = ${ctx.meta.profile})`,
          },
        };
      }

      // sesijoj freelancer
      if (!ctx.meta.profile && ctx.meta?.user) {
        return {
          ...q,
          createdBy: ctx.meta.user.id,
          tenant: { $exists: false },
        };
      }
    }
    return q;
  }

  @Event()
  async 'fishBatches.*'(ctx: Context<EntityChangedParams<FishBatch>>) {
    //Generates an object with amounts of fish stocked and stores in the database.
    //TODO: could be virtual field instead
    const type = ctx.params.type;
    let fishBatches = ctx.params.data;
    if (!Array.isArray(fishBatches)) {
      fishBatches = [fishBatches];
    }

    const $set: { fishTypes?: any } = {};

    const adapter = await this.getAdapter(ctx);
    const table = adapter.getTable();

    switch (type) {
      case 'create':
      case 'update':
      case 'replace':
        const fishTypes: Record<FishBatch['id'], FishType['id']> = {};
        for (const fb of fishBatches) {
          fishTypes[fb.id] = fb.fishType.id;
        }

        $set.fishTypes = table.client.raw(`fish_types || '${JSON.stringify(fishTypes)}'::jsonb`);
        break;

      case 'remove':
        $set.fishTypes = table.client.raw(`fish_types - '${fishBatches[0].id}'`);
        break;
    }

    const fishStocking = await this.resolveEntities(ctx, {
      id: fishBatches[0].fishStocking,
    });

    if (fishStocking) {
      await this.updateEntity(
        ctx,
        {
          id: fishBatches[0].fishStocking,
          $set,
        },
        {
          raw: true,
          permissive: true,
        },
      );
    }
  }

  async started() {
    await this.broker.waitForServices(['locations']);
    const fishStockings: FishStocking[] = await this.actions.find({
      query: {
        $raw: `location->>'category' IS NULL`,
      },
    });
    for (const fishStocking of fishStockings) {
      try {
        const cadastralId = fishStocking.location?.cadastral_id;
        if (!cadastralId) continue;
        const uetkObject: Location = await this.broker.call('locations.uetkSearchByCadastralId', {
          cadastralId,
        });
        if (!uetkObject) continue;
        await this.actions.update({
          id: fishStocking.id,
          location: uetkObject,
        });
      } catch (e) {
        continue;
      }
    }
  }
}
