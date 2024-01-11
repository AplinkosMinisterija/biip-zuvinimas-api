'use strict';

import moleculer, { Context } from 'moleculer';
import {Action, Method, Service} from 'moleculer-decorators';

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
import { FishAge } from './fishAges.service';
import { FishStocking } from './fishStockings.service';
import { FishType } from './fishTypes.service';
import {UserAuthMeta} from "./api.service";


interface Fields extends CommonFields {
  fishType: FishType;
  fishAge: FishAge;
  id?: number;
  amount?: number;
  weight?: number;
  reviewAmount?: number;
  reviewWeight?: number;
  fishStocking?: number;
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
  // TODO: remove after old data migrate
  @Action()
  createPermissive(ctx: Context) {
    return this.createEntity(ctx, ctx.params, {
      permissive: true,
    });
  }

  @Action({
    params: {
      batches: 'array',
      fishStocking: 'number',
    },
  })
  async createBatches(
    ctx: Context<{
      batches: FishBatch[];
      fishStocking: number;
    }>,
  ) {
    console.log('batches!!!', ctx.params.batches)
    if (ctx.params.batches) {
      const promises = ctx.params.batches?.map((batch) => {
        return ctx.call('fishBatches.create', {
          fishType: batch.fishType,
          fishAge: batch.fishAge,
          amount: batch.amount,
          weight: batch.weight,
          fishStocking: ctx.params.fishStocking,
        });
      });
      await Promise.all(promises);
    }
  }

  @Action({
    params: {
      batches: {
        type: 'array',
        required: false,
        properties: {
          id: 'number|optional',
          fishType: 'number',
          fishAge: 'number',
          amount: 'number',
          weight: 'number|optional',
          reviewAmount: 'number|optional',
          reviewWeight: 'number|optional',
        }
      },
      fishStocking: 'number|optional',
    },
  })
  //for admin
  async updateBatches(
    ctx: Context<{
      batches: FishBatch[];
      fishStocking: number;
    }, UserAuthMeta>,
  ) {
    const batches = ctx.params.batches?.map(item => {
      if (
          typeof item !== "object" ||
          item === null ||
          Array.isArray(item) ||
          typeof item.id !== "number" ||
          !(typeof item.reviewAmount == "number" && Number.isInteger(item.reviewAmount)) ||
          typeof item.reviewWeight !== "number"
      ) {
        throw new moleculer.Errors.ValidationError('Invalid batch data');
      } else {
        return {
          id: item.id,
          amount: item.amount,
          weight: item.weight,
          reviewAmount: item.reviewAmount,
          reviewWeight: item.reviewWeight,
        }
      }
    });
    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, batches);
    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking || 1,
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
            id: 'number|optional',
            fishType: 'number|optional',
            fishAge: 'number|optional',
            amount: 'number',
            weight: 'number|optional'
          }
        }
      },
      fishStocking: 'number|optional',
    },
  })
  async updateRegisteredBatches(
      ctx: Context<{
        batches: FishBatch[];
        fishStocking: number;
      }, UserAuthMeta>,
  ) {
    const batches = ctx.params.batches?.map(item => {
      if (
          typeof item !== "object" ||
          item === null ||
          Array.isArray(item) ||
          !["undefined", "number"].some((type)=> type === typeof item.id) ||
          !["undefined", "number"].some((type)=> type === typeof item.weight) ||
          !(typeof item.amount == "number" && Number.isInteger(item.amount))
      ) {
        throw new moleculer.Errors.ValidationError('Invalid batch data');
      } else {
        return {
          id: item.id,
          amount: item.amount,
          weight: item.weight,
        }
      }
    });

    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, batches);

    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking || 1,
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
            id: 'number',
            reviewAmount: 'number',
            reviewWeight: 'number|optional'
          }
        }
      },
      fishStocking: 'number|optional',
    },
  })
  async reviewBatches(
      ctx: Context<{
        batches: FishBatch[];
        fishStocking: number;
      }, UserAuthMeta>,
  ) {

    const batches = ctx.params.batches?.map(item => {
      if (
          typeof item !== "object" ||
          item === null ||
          Array.isArray(item) ||
          typeof item.id !== "number" ||
          !(typeof item.reviewAmount == "number" && Number.isInteger(item.reviewAmount)) ||
          !["undefined", "number"].some((type)=> type === typeof item.reviewWeight)
      ) {
        throw new moleculer.Errors.ValidationError('Invalid batch data');
      } else {
        return {
          id: item.id,
          reviewAmount: item.reviewAmount,
          reviewWeight: item.reviewWeight,
        }
      }
    });
    await this.deleteExistingBatches(ctx, ctx.params.fishStocking, batches);
    await this.createOrUpdateBatches(ctx, ctx.params.fishStocking, batches);
    return await this.findEntities(ctx, {
      query: {
        fishStocking: ctx.params.fishStocking || 1,
      },
    });
  }

  @Action()
  async getAll(ctx: Context) {
    return this.findEntities(ctx, ctx.params);
  }

  @Method
  async deleteExistingBatches(ctx: Context, fishStockingId: number, batches: any[]) {
    const existingBatches: FishBatch[] = await this.findEntities(ctx, {
      query: { fishStockingId },
    });
    const deleteBatches = filter(
        existingBatches,
        (item: FishBatch) => batches?.some((batch) => batch.id === item.id),
    );
    const promises = map(deleteBatches, (batch: FishBatch) => this.removeEntity(ctx, batch));
    await Promise.all(promises);
  }

  @Method
  async createOrUpdateBatches(ctx: Context, fishStocking: number, batches: any[]) {
    const promises = batches?.map( (batch: FishBatch) => {
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
