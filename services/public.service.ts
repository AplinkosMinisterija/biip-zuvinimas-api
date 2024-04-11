'use strict';

import { format } from 'date-fns';
import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import { EntityChangedParams, RestrictionType } from '../types';
import { FishStocking } from './fishStockings.service';
import { CompletedFishBatch, FishStockingsCompleted } from './fishStockingsCompleted.service';
import { TenantUser } from './tenantUsers.service';

const uetkStatisticsParams = {
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
};

type StatsById = {
  [id: string]: {
    count: number;
    fishType: {
      id: number;
      label: string;
    };
  };
};

type StatsByYear = {
  [year: string]: StatsByCadastralId;
};

type StatsByCadastralId = {
  count: number;
  byFish?: StatsById;
  byYear?: StatsByYear;
};

type Statistics = {
  [cadastralId: string]: StatsByCadastralId;
};

type Batches = Array<CompletedFishBatch & { cadastralId: string; year: string }>;

type BatchesById = {
  [id: string]: Batches;
};

const getByFish = (batches: Batches) => {
  return batches?.reduce(
    (aggregate, value) => {
      aggregate.count += value.count;
      let fishTypeData = aggregate.byFish[value.fish_type.id];
      if (fishTypeData) {
        fishTypeData.count += value.count;
      } else {
        fishTypeData = { count: value.count, fishType: value.fish_type };
      }
      aggregate.byFish[value.fish_type.id] = fishTypeData;
      return aggregate;
    },
    { count: 0, byFish: {} } as StatsByCadastralId,
  );
};

const getStatsByYear = (batches: Batches) => {
  const batchesByYear = batches?.reduce((aggregate, value) => {
    aggregate[value.year] = [...(aggregate[value.year] || []), value];
    return aggregate;
  }, {} as BatchesById);

  const statistics: StatsByYear = {};

  for (const year in batchesByYear) {
    const yearBatches = batchesByYear[year];
    const stats: Omit<StatsByCadastralId, 'byYear'> = getByFish(yearBatches);
    statistics[year] = stats;
  }

  return statistics;
};

const getCount = (batches: Batches) => {
  return batches?.reduce((aggregate, batch) => batch.count + aggregate, 0);
};

@Service({
  name: 'public',
})
export default class FishAgesService extends moleculer.Service {
  @Action({
    rest: 'GET /fishStockings',
    auth: RestrictionType.PUBLIC,
  })
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
    rest: 'GET /uetk/statistics',
    params: uetkStatisticsParams,
    auth: RestrictionType.PUBLIC,
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async uetkStatistics(
    ctx: Context<{ date: any; fishType: number; year: number; cadastralId: string } & any>,
  ) {
    const batchesByCadastralId = await this.getFilteredBatches(ctx);

    const statistics: Statistics = {};

    for (const cadastralId in batchesByCadastralId) {
      const cadastralIdBatches = batchesByCadastralId[cadastralId];
      statistics[cadastralId] = getByFish(cadastralIdBatches);
    }

    return statistics;
  }

  @Action({
    rest: 'GET /uetk/statistics/byYear',
    // params: uetkStatisticsParams,
    auth: RestrictionType.PUBLIC,
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async uetkStatisticsByYear(
    ctx: Context<{ date: any; fishType: number; year: number; cadastralId: string } & any>,
  ) {
    const batchesByCadastralId = await this.getFilteredBatches(ctx);

    const statistics: Statistics = {};

    for (const cadastralId in batchesByCadastralId) {
      const batches = batchesByCadastralId[cadastralId];
      const statsByYear: StatsByYear = getStatsByYear(batches);
      statistics[cadastralId] = {
        count: getCount(batches),
        byYear: statsByYear,
      };
    }

    return statistics;
  }

  @Method
  async getFilteredBatches(
    ctx: Context<{ date: any; fishType: number; year: number; cadastralId: string } & any>,
  ) {
    const { fishType, date, cadastralId } = ctx.params;

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

    const completedFishStockings: FishStockingsCompleted[] = await ctx.call(
      'fishStockingsCompleted.find',
      {
        query,
      },
    );

    const filteredBatches = completedFishStockings
      ?.map((stocking) =>
        stocking.fishBatches?.map((batch) => ({
          ...batch,
          cadastralId: stocking.location.cadastral_id,
          year: format(new Date(stocking.reviewTime), 'yyyy'),
        })),
      )
      ?.flat();
    return filteredBatches.reduce((aggregate, value) => {
      aggregate[value.cadastralId] = [...(aggregate[value.cadastralId] || []), value];
      return aggregate;
    }, {} as BatchesById);
  }

  @Event()
  async 'fishStockings.*'(ctx: Context<EntityChangedParams<TenantUser>>) {
    switch (ctx.params.type) {
      case 'create':
      case 'update':
      case 'remove':
        await this.broker.cacher.clean('public.**');
    }
  }
}
