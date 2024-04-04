'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';

import { endOfYear, startOfYear } from 'date-fns/fp';
import { GeomFeature } from '../modules/geometry';
import { FishBatch } from './fishBatches.service';
import { FishStockingPhoto } from './fishStockingPhotos.service';
import { FishStocking } from './fishStockings.service';
import { FishStockingsCompleted } from './fishStockingsCompleted.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

interface KeyValue {
  [key: string]: any;
}

type FishBatchesStats = {
  [cadastralId: string]: {
    count: number;
    cadastralId: string;
    [key: string]:
      | any
      | {
          count: number;
          fishType: { id: number; label: string };
        };
  };
};

type StatsByCadastralIdAndFish = {
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
    const query: any = { reviewAmount: { $exists: true } };

    if (fishType) {
      query.fishType = fishType;
    }

    if (date) {
      query.createdAt = date;
      try {
        query.createdAt = JSON.parse(date);
      } catch (err) {}
    }

    // if (cadastralId) {
    //   query.$raw = {
    //     condition: `?? @> ?::jsonb`,
    //     bindings: ['location', { cadastral_id: [cadastralId] }],
    //   };
    // }

    if (year) {
      console.log('year!!!', year);
      const yearDate = new Date(year);
      const startTime = startOfYear(yearDate);
      const endTime = endOfYear(yearDate);
      query.createdAt = {
        $gte: startTime.toDateString(),
        $lt: endTime.toDateString(),
      };
      query.$raw = {
        condition: ``,
      };
    }

    const fishBatches: FishBatch<'fishStocking' | 'fishType'>[] = await ctx.call(
      'fishBatches.find',
      {
        query,
        populate: ['fishStocking', 'fishType'],
      },
    );

    const stats = fishBatches.reduce((groupedFishBatch, fishBatch) => {
      const cadastralId = fishBatch?.fishStocking?.location?.cadastral_id;
      const fishTypeId = fishBatch?.fishType?.id;

      if (!cadastralId) return groupedFishBatch;

      groupedFishBatch[cadastralId] = groupedFishBatch[cadastralId] || {
        count: 0,
        cadastralId: cadastralId,
      };

      groupedFishBatch[cadastralId].count += fishBatch.reviewAmount;

      groupedFishBatch[cadastralId][fishTypeId] = groupedFishBatch[cadastralId][fishTypeId] || {
        count: 0,
        fishType: { id: fishTypeId, label: fishBatch?.fishType?.label },
      };

      groupedFishBatch[cadastralId][fishTypeId].count += fishBatch.reviewAmount;

      return groupedFishBatch;
    }, {} as FishBatchesStats);

    return Object.values(stats).reduce(
      (groupedFishBatch: KeyValue, currentGroupedFishBatch: KeyValue) => {
        const { cadastralId, count, ...rest } = currentGroupedFishBatch;
        groupedFishBatch[cadastralId] = {
          count,
          byFishes: Object.values(rest),
        };
        return groupedFishBatch;
      },
      {} as StatsByCadastralIdAndFish,
    );
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      path: '/uetk/statistics2',
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
  async getStatisticsForUETK2(
    ctx: Context<{ date: any; fishType: number; year: number; cadastralId: string }>,
  ) {
    const { fishType, date, year, cadastralId } = ctx.params;
    const query: any = { review_time: { $exists: true } };

    if (fishType) {
      query.fishType = fishType;
    }

    if (date) {
      query.reviewTime = date;
      try {
        query.reviewTime = JSON.parse(date);
      } catch (err) {}
    }

    if (cadastralId) {
      query.$raw = {
        condition: `?? @> ?::jsonb`,
        bindings: ['location', { cadastral_id: [cadastralId] }],
      };
    }

    if (year) {
      const yearDate = new Date().setFullYear(year);
      const startTime = startOfYear(yearDate);
      const endTime = endOfYear(yearDate);
      console.log('year', yearDate, startTime, endTime);
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

    return completedFishStockings;
  }
}
