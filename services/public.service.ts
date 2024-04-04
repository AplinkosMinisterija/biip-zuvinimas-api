'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';

import { endOfYear, startOfYear } from 'date-fns/fp';
import { GeomFeature } from '../modules/geometry';
import { FishBatch } from './fishBatches.service';
import { FishStockingPhoto } from './fishStockingPhotos.service';
import { FishStocking } from './fishStockings.service';
import { CompletedFishBatch, FishStockingsCompleted } from './fishStockingsCompleted.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

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
  location: GeomFeature;
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
  signatures?: {
    organization: string;
    signedBy: string;
    signature: string;
  }[];
  assignedToInspector?: number;
}

interface Populates extends CommonPopulates {}

export type FishAge<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'public',
})
export default class FishAgesService extends moleculer.Service {
  @Action({
    rest: 'GET /fishStockings',
    auth: RestrictionType.PUBLIC,
  })
  //TODO: could be moved to fishStockings service
  async getPublicFishStockings(ctx: Context<any>) {
    const params = {
      ...ctx.params,
      fields: [
        'id',
        'eventTime',
        'location',
        'coordinates',
        'status',
        'batches',
        'deletedAt',
        'canceledAt',
      ],
      populate: ['location', 'coordinates', 'status', 'batches'],
    };
    return ctx.call('fishStockings.find', params);
  }

  @Action({
    rest: 'GET /statistics',
    auth: RestrictionType.PUBLIC,
  })
  //TODO: could be moved to fishStockings service
  async getStatistics(ctx: Context<any>) {
    const completedFishStockings: FishStocking[] = await ctx.call('fishStockings.count', {
      filter: {
        status: ['FINISHED', 'INSPECTED'],
      },
    });

    const locationsCount = await ctx.call('fishStockings.getLocationsCount');

    const fishCount = await ctx.call('fishStockings.getFishCount');

    return {
      fish_stocking_count: completedFishStockings,
      fishing_area_count: locationsCount,
      fish_count: fishCount,
    };
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      path: '/uetk/statistics',
    },
    params: {
      date: [
        {
          type: 'string',
          optional: true,
        },
        {
          type: 'object',
          optional: true,
        },
      ],
      fishType: {
        type: 'number',
        convert: true,
        optional: true,
      },
      year: 'number|convert|optional',
      cadastralId: 'string|optional',
    },
    auth: RestrictionType.PUBLIC,
  })
  async getStatisticsForUETK(
    ctx: Context<{ date: any; fishType: number; year: number; cadastralId: string }>,
  ) {
    const { fishType, date, year, cadastralId } = ctx.params;
    const query: any = {};

    if (fishType) {
      const condition = `fish_batches::jsonb @> '[{"fish_type": {"id": ${fishType} }}]'`;
      query.$raw = {
        condition,
      };
    }

    if (date) {
      query.reviewTime = date;
      try {
        query.reviewTime = JSON.parse(date);
      } catch (err) {}
    }

    if (cadastralId) {
      let condition = `location::jsonb @> '{"cadastral_id": "${cadastralId}"}'`;
      if (query.$raw?.condition) {
        condition = query.$raw?.condition + ' AND ' + condition;
      }
      query.$raw = {
        condition,
      };
    }

    if (year) {
      const yearDate = new Date().setFullYear(year);
      const startTime = startOfYear(yearDate);
      const endTime = endOfYear(yearDate);
      query.reviewTime = {
        $gte: startTime.toDateString(),
        $lt: endTime.toDateString(),
      };
    }

    const completedFishStockings: FishStockingsCompleted[] = await ctx.call(
      'fishStockingsCompleted.find',
      {
        query,
      },
    );

    const selectedBatches: Array<CompletedFishBatch & { cadastralId: string }> =
      completedFishStockings
        ?.map((stocking) =>
          stocking.fishBatches?.map((batch) => ({
            ...batch,
            cadastralId: stocking.location.cadastral_id,
          })),
        )
        ?.flat();

    const batchesByCadastralId = selectedBatches.reduce((aggregate, value) => {
      const { cadastralId } = value;
      if (aggregate[cadastralId]) {
        aggregate[cadastralId] = [...aggregate[cadastralId], value];
      } else {
        aggregate[cadastralId] = [value];
      }
      return aggregate;
    }, {} as { [cadastralId: string]: Array<CompletedFishBatch & { cadastralId: string }> });

    const statistics: {
      [cadastralId: string]: {
        count: number;
        byFish: {
          [fishId: string]: {
            count: number;
            fishType: {
              id: number;
              label: string;
            };
          };
        };
      };
    } = {};

    for (const cadastralId in batchesByCadastralId) {
      const batches = batchesByCadastralId[cadastralId];
      const data = batches.reduce(
        (aggregate, value) => {
          aggregate.count += value.count;
          let fishTypeData = aggregate.byFish?.[value.fish_type.id];
          if (fishTypeData) {
            fishTypeData.count += value.count;
          } else {
            fishTypeData = { count: value.count, fishType: value.fish_type };
          }
          aggregate.byFish[value.fish_type.id] = fishTypeData;
          return aggregate;
        },
        { count: 0, byFish: {} } as {
          count: number;
          byFish: {
            [fishTypeId: string]: { count: number; fishType: { id: number; label: string } };
          };
        },
      );
      statistics[cadastralId] = data;
    }

    return statistics;
  }
}
