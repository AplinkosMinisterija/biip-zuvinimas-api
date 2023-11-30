'use strict';

import { add, endOfDay, isAfter, isBefore, startOfDay, sub } from 'date-fns';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import { GeomFeatureCollection, coordinatesToGeometry, geometryToGeom } from '../modules/geometry';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  EntityChangedParams,
  FieldHookCallback,
  RestrictionType,
  Table,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { isEmpty, map } from 'lodash';
import moleculer, { Context } from 'moleculer';

import { DbContextParameters } from 'moleculer-db';
import ApiGateway from 'moleculer-web';
import XLSX from 'xlsx';
import DbConnection from '../mixins/database.mixin';
import GeometriesMixin from '../mixins/geometries.mixin';
import { FishBatch } from './fishBatches.service';
import { FishStockingPhoto } from './fishStockingPhotos.service';
import { FishType } from './fishTypes.service';
import { Setting } from './settings.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

const Readable = require('stream').Readable;

export enum FishStockingStatus {
  UPCOMING = 'UPCOMING',
  ONGOING = 'ONGOING',
  NOT_FINISHED = 'NOT_FINISHED',
  FINISHED = 'FINISHED',
  INSPECTED = 'INSPECTED',
  CANCELED = 'CANCELED',
}

const statusLabels = {
  [FishStockingStatus.UPCOMING]: "Būsimas įžuvinimas",
  [FishStockingStatus.ONGOING]: "Šiandien vykstantis įžuvinimas",
  [FishStockingStatus.CANCELED]: "Atšaukta",
  [FishStockingStatus.FINISHED]: "Ižuvinta",
  [FishStockingStatus.INSPECTED]: "Ižuvinta",
  [FishStockingStatus.NOT_FINISHED]: "Neužbaigta"
};

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

const isCanceled = (fishStocking: any) => {
  return !!fishStocking.canceledAt;
};

const isReviewed = (fishStocking: any, batches: FishBatch[]) => {
  const batchesDataNotFilled = batches?.some((batch: any) => batch.reviewAmount === null);
  return !batchesDataNotFilled;
};

const isInspected = (fishStocking: FishStocking, batches: FishBatch[]) => {
  const reviewed = isReviewed(fishStocking, batches);
  return reviewed && !isEmpty(fishStocking.signatures);
};

const isOngoing = (fishStocking: FishStocking, settings: Setting) => {
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

const isUpcoming = (fishStocking: FishStocking) => {
  const start = startOfDay(fishStocking.eventTime);
  return isBefore(new Date(), start);
};

const isNotFinished = (fishStocking: FishStocking, settings: Setting) => {
  const eventTime = new Date(fishStocking.eventTime);
  const end = endOfDay(
    add(eventTime, {
      days: settings.maxTimeForRegistration,
    }),
  );
  return isAfter(new Date(), end);
};

interface Fields extends CommonFields {
  id: number;
  eventTime: Date;
  comment?: string;
  tenant?: Tenant['id'];
  stockingCustomer?: Tenant['id'];
  fishOrigin: string;
  fishOriginCompanyName?: string;
  fishOriginReservoir?: {
    id: string;
    name: string;
    municipality: { id: string; label: string };
  };
  location: {
    name: string;
    area: number;
    cadastral_id: string;
    municipality: {
      id: number;
      name: string;
    };
  };
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
  status: FishStockingStatus
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
        update: false,
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
      fishOrigin: 'string|required',
      fishOriginCompanyName: 'string',
      fishOriginReservoir: 'object',
      location: {
        type: 'object',
        raw: true,
        required: false,
        properties: {
          cadastral_id: 'string',
          name: 'string',
          municipality: 'object',
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
      phone: 'string|required',
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
          phone: 'string|optional',
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
            this.getStatus(ctx, fishStocking, batchesByStocking[fishStocking.id], settings),
          );
        },
      },
      //TODO: refaktor  so that  mandatory would not be virtual field
      mandatory: {
        virtual: true,
        get: async ({ entity, ctx }: FieldHookCallback) => {
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
        },
      },
      canceledAt: 'string',
      oldId: 'number',
      fishTypes: { type: 'object', default: {}, hidden: 'byDefault' },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['batches', 'status'],
  },
  hooks: {
    before: {
      create: ['parseGeomField', 'parseReviewLocationField'],
      updateFishStocking: ['parseGeomField'],
      updateRegistration: ['parseGeomField'],
      register: ['parseGeomField'],
      review: ['parseReviewLocationField'],
      list: ['beforeSelect', 'handleSort'],
      find: ['beforeSelect', 'handleSort'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect', 'handleSort'],
      export: ['beforeSelect', 'handleSort'],
      remove: ['beforeDelete'],
    },
  },
})
export default class FishStockingsService extends moleculer.Service {
  @Action()
  async getLocations() {
    const adapter = await this.getAdapter();
    const knex = adapter.client;
    return knex.raw(
      `select distinct on ("location"::jsonb->'cadastral_id') "location" from "fish_stockings"`,
    );
  }

  @Action({
    rest: 'PATCH /cancel/:id',
    auth: RestrictionType.USER,
  })
  async cancel(ctx: Context<any>) {
    const fishStocking = await this.resolveEntities(ctx, { id: ctx.params.id });
    if (
      fishStocking.status === FishStockingStatus.UPCOMING ||
      fishStocking.status === FishStockingStatus.ONGOING ||
      fishStocking.status === FishStockingStatus.NOT_FINISHED
    ) {
      return this.updateEntity(ctx, {
        id: ctx.params.id,
        canceledAt: new Date().toDateString(),
      });
    }
  }

  @Action({
    rest: 'PATCH /:id',
    auth: RestrictionType.ADMIN,
    params: {
      eventTime: 'string|optional',
      comment: 'string|optional',
      tenant: 'number|optional',
      stockingCustomer: 'number|optional',
      fishOrigin: 'string|optional',
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: 'object|optional',
      location: 'object|optional',
      geom: 'any|optional',
      batches: 'array|optional',
      assignedTo: 'number|optional',
      phone: 'string|optional',
      waybillNo: 'string|optional',
      veterinaryApprovalNo: 'string|optional',
      veterinaryApprovalOrderNo: 'string|optional',
      containerWaterTemp: 'number|optional',
      waterTemp: 'number|optional',
      signatures: 'any|optional',
      inspector: 'number|optional',
      canceledAt: 'string|optional',
    },
  })
  async updateFishStocking(ctx: Context<any, UserAuthMeta>) {
    const fishStockingBeforeUpdate = await this.resolveEntities(ctx);
    if (ctx.params.inspector) {
      const inspector: any = await ctx.call('auth.users.get', {
        id: ctx.params.inspector,
      });
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
      if (ctx.params.batches) {
        await ctx.call('fishBatches.updateBatches', {
          batches: ctx.params.batches,
          fishStocking: Number(ctx.params.id),
        });
      }
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
    if (ctx.params.batches) {
      await ctx.call('fishBatches.updateBatches', {
        batches: ctx.params.batches,
        fishStocking: Number(ctx.params.id),
      });
    }
    return this.updateEntity(ctx);
  }

  @Action({
    rest: 'POST /register',
    auth: RestrictionType.USER,
    cache: false,
    params: {
      eventTime: 'string',
      phone: 'string',
      assignedTo: 'number',
      location: {
        type: 'object',
        properties: {
          cadastral_id: 'string',
          name: 'string',
          municipality: 'object',
        },
      },
      geom: 'any',
      batches: 'array',
      fishOrigin: 'string',
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: 'object|optional',
      tenant: 'number|optional',
      stockingCustomer: 'number|optional',
    },
  })
  async register(ctx: Context<any>) {
    const fishStocking: FishStocking = await this.createEntity(ctx);
    await ctx.call(
      'fishBatches.createMany',
      ctx.params.batches.map((batch: FishBatch) => ({
        ...batch,
        fishStocking: fishStocking.id,
      })),
    );
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
    return this.resolveEntities(ctx, { id: fishStocking.id });
  }

  @Action({
    rest: 'PATCH /register/:id',
    auth: RestrictionType.USER,
    cache: false,
    params: {
      eventTime: 'string',
      phone: 'string',
      assignedTo: {
        type: 'number',
        columnType: 'integer',
        columnName: 'assignedToId',
        required: false,
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
          municipality: 'object',
        },
      },
      batches: 'array',
      fishOrigin: 'string',
      fishOriginCompanyName: 'string|optional',
      fishOriginReservoir: 'object|optional',
      tenant: 'number|optional',
      stockingCustomer: 'number|optional',
    },
  })
  async updateRegistration(ctx: Context<any>) {
    const fishStocking: FishStocking = await this.updateEntity(ctx, ctx.params);

    await ctx.call('fishBatches.updateBatches', {
      batches: ctx.params.batches,
      fishStocking: Number(ctx.params.id),
    });

    return this.resolveEntities(ctx, {
      id: Number(fishStocking.id),
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
      batches: 'array',
      signatures: 'any|optional',
      comment: 'string|optional',
    },
  })
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
    await this.updateEntity(ctx, {
      ...ctx.params,
      reviewedBy: ctx.meta.user.id,
      reviewTime: new Date(),
    });

    await ctx.call('fishBatches.updateBatches', {
      batches: ctx.params.batches,
      fishStocking: ctx.params.id,
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
  async getRecentLocations(ctx: Context<DbContextParameters, UserAuthMeta>) {
    const { profile, user } = ctx.meta;
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    let response;
    if (profile) {
      response = await knex.raw(
        `select distinct on ("location"::jsonb->'cadastral_id') "location", "id" from "fish_stockings" where "tenant_id" = ${profile} limit 5`,
      );
    } else if (user) {
      response = await knex.raw(
        `select distinct on ("location"::jsonb->'cadastral_id') "location", "id" from "fish_stockings" where "created_by" = ${user.id} limit 5`,
      );
    }
    const data = [];
    for (const row of response.rows) {
      const id = row.id;
      const geom = await ctx.call('fishStockings.getGeometryJson', {
        id,
      });
      data.push({
        ...row.location,
        geom,
      });
    }
    return data;
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
    const data: any = await ctx.call('fishStockings.find', {
      ...ctx.params,
      populate: ['assignedTo', 'reviewedBy', 'batches'],
    });
    const mappedData: any[] = [];
    data.map((fishStocking: FishStocking<'reviewedBy'|'assignedTo' |'batches'>) => {
      const fishOrigin =
        fishStocking.fishOrigin === 'GROWN'
          ? fishStocking?.fishOriginCompanyName
          : fishStocking?.fishOriginReservoir;

      const date = fishStocking?.eventTime || '-';
      const municipality = fishStocking.location.municipality?.name || '-';
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
          'Žuvų, vėžių rūšis': batch.fishType?.label,
          Amžius: batch.fishAge?.label,
          'Planuojamas kiekis, vnt': batch.amount || 0,
          'Kiekis, vnt.': batch.reviewAmount || 0,
          'Planuojamas svoris, kg' : batch.weight || 0,
          'Svoris, kg': batch.reviewWeight || 0,
          'Žuvys išaugintos': fishOrigin,
          'Važtaraščio nr.': waybillNo || '',
          'Atsakingas asmuo': assignedTo || '',
          'Veterinarinio pažymėjimo Nr.': veterinaryApprovalNo || '',
          'Būsena': statusLabels[status],
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
      reviewLocation?: any;
    }>,
  ) {
    const { reviewLocation } = ctx.params;

    if (isEmpty(reviewLocation)) {
      ctx.params.reviewLocation = null;
      return ctx;
    }

    const reviewLocationGeom: any = coordinatesToGeometry(reviewLocation);
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
  getStatus(ctx: Context, fishStocking: FishStocking, batches: FishBatch[], settings: Setting) {
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

  @Method
  async beforeSelect(ctx: Context<any, UserAuthMeta>) {
    const profilesQuery = await this.handleProfile(ctx.params.query || {}, ctx);
    let query = {
      ...ctx.params.query,
      ...profilesQuery,
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

  @Method
  async beforeDelete(ctx: Context<any, UserAuthMeta>) {
    if (ctx.meta.user) {
      const fishStocking: FishStocking[] = await ctx.call('fishStockings.find', {
        query: {
          id: ctx.params.id,
          tenantId: ctx.meta.profile || null,
          createdBy: ctx.meta.user.id,
        },
      });
      if (!fishStocking[0]) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
          error: 'Unauthorized',
          scope: false,
        });
      }
      const settings: Setting = await ctx.call('settings.getSettings');
      const minTime = settings.minTimeTillFishStocking;
      const maxPermittedTime = sub(fishStocking[0].eventTime, {
        days: minTime,
      });

      const validTime = isBefore(new Date(), maxPermittedTime);
      if (!validTime) {
        throw new moleculer.Errors.MoleculerClientError(
          'Current time is after permitted deletion time',
          422,
          'INVALID_TIME',
        );
      }
    }
    return ctx;
  }
  @Event()
  async 'fishBatches.*'(ctx: Context<EntityChangedParams<FishBatch>>) {
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
}
