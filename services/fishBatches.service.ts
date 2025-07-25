'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import { filter, map } from 'lodash';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';
import { FishAge } from './fishAges.service';
import { FishStocking } from './fishStockings.service';
import { FishType } from './fishTypes.service';

interface Fields extends CommonFields {
  id: number;
  fishType: FishType;
  fishAge: FishAge;
  fishStocking: FishStocking['id'];
  amount: number;
  weight?: number;
  reviewAmount?: number;
  reviewWeight?: number;
}

interface Populates extends CommonPopulates {
  fishType: FishType;
  fishAge: FishAge;
  fishStocking: FishStocking;
}

export type FishBatch<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishBatches',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      fishType: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishTypeId',
        required: true,
        populate: {
          action: 'fishTypes.resolve',
          params: { scope: false },
        },
      },
      fishAge: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishAgeId',
        required: true,
        populate: {
          action: 'fishAges.resolve',
          params: { scope: false },
        },
      },
      amount: 'number|required',
      weight: 'number',
      reviewAmount: 'number',
      reviewWeight: 'number',
      fishStocking: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishStockingId',
        required: true,
        populate: {
          action: 'fishStockings.resolve',
        },
      },
      oldId: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['fishType', 'fishAge'],
  },
})
export default class FishBatchesService extends moleculer.Service {
  @Action({
    params: {
      batches: {
        type: 'array',
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
      fishStocking: 'number|integer|positive',
    },
  })
  async createBatches(
    ctx: Context<{
      batches: FishBatch[];
      fishStocking: number;
    }>,
  ) {
    if (ctx.params.batches) {
      const batches = ctx.params.batches?.map((batch) => ({
        fishType: batch.fishType,
        fishAge: batch.fishAge,
        amount: batch.amount,
        weight: batch.weight,
        fishStocking: ctx.params.fishStocking,
      }));
      await ctx.call('fishBatches.createMany', batches);
    }
  }

  @Action({
    params: {
      batches: {
        type: 'array',
        required: false,
        items: {
          type: 'object',
          properties: {
            id: 'number|integer|positive|optional',
            fishType: 'number|integer|positive|convert',
            fishAge: 'number|integer|positive|convert',
            amount: 'number|integer|positive|convert',
            weight: 'number|optional|convert',
            reviewAmount: 'number|integer|positive|optional|convert',
            reviewWeight: 'number|optional|convert',
          },
        },
      },
      fishStocking: 'number|integer|positive',
    },
  })
  //for admin
  async updateBatches(
    ctx: Context<
      {
        batches: FishBatch[];
        fishStocking: number;
      },
      UserAuthMeta
    >,
  ) {
    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, ctx.params.batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, ctx.params.batches);
    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking,
      },
    });
  }

  @Action({
    params: {
      batches: {
        type: 'array',
        required: false,
        items: {
          type: 'object',
          properties: {
            id: 'number|integer|positive|optional',
            fishType: 'number|integer|positive|optional',
            fishAge: 'number|integer|positive|optional',
            amount: 'number|integer|positive',
            weight: 'number|optional',
          },
        },
      },
      fishStocking: 'number|integer|positive',
    },
  })
  async updateRegisteredBatches(
    ctx: Context<
      {
        batches: FishBatch[];
        fishStocking: number;
      },
      UserAuthMeta
    >,
  ) {
    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, ctx.params.batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, ctx.params.batches);

    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking,
      },
    });
  }

  @Action({
    params: {
      batches: {
        type: 'array',
        required: false,
        items: {
          type: 'object',
          properties: {
            id: 'number|integer|optional|positive',
            amount: { type: 'number', optional: true, integer: true, min: 0, convert: true },
            weight: { type: 'number', optional: true, min: 0, convert: true },
            reviewAmount: { type: 'number', integer: true, min: 0, convert: true },
            reviewWeight: { type: 'number', optional: true, min: 0, convert: true },
          },
        },
      },
      fishStocking: 'number|integer|positive',
    },
  })
  async reviewBatches(
    ctx: Context<
      {
        batches: FishBatch[];
        fishStocking: number;
      },
      UserAuthMeta
    >,
  ) {
    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, ctx.params.batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, ctx.params.batches);
    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking,
      },
    });
  }

  @Action()
  async getAll(ctx: Context) {
    return this.findEntities(ctx, ctx.params);
  }

  @Method
  async deleteExistingBatches(ctx: Context, fishStockingId: number, batches: FishBatch[]) {
    const existingBatches: FishBatch[] = await this.findEntities(ctx, {
      query: { fishStocking: fishStockingId },
    });
    const deleteBatches = filter(
      existingBatches,
      (existingBatch: FishBatch) =>
        !batches?.find((batch) => batch.id && existingBatch.id == batch.id),
    );
    const promises = map(deleteBatches, (batch: FishBatch) => this.removeEntity(ctx, batch));
    await Promise.all(promises);
  }

  @Method
  async createOrUpdateBatches(ctx: Context, fishStocking: number, batches: any[]) {
    const promises = batches?.map((batch: FishBatch) => {
      if (batch.id) {
        return this.updateEntity(ctx, batch);
      }
      return this.createEntity(ctx, {
        ...batch,
        fishStocking,
      });
    });
    await Promise.all(promises);
  }
}
