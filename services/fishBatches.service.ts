'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

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
import { FishType } from './fishTypes.service';

interface Fields extends CommonFields {
  id: number;
  fishType: FishType;
  fishAge: FishAge;
  amount: number;
  weight: number;
  reviewAmount: number;
  reviewWeight: number;
  fishStocking: number;
}

interface Populates extends CommonPopulates {
  fishTypes: FishType;
  fishAge: FishAge;
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

  //TODO: different batches validation during registration, review and when editing trough admin
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
    const promises = ctx.params.batches?.map((batch: any) => {
      return ctx.call('fishBatches.create', {
        ...batch,
        fishStocking: ctx.params.fishStocking,
      });
    });
    await Promise.all(promises);
  }

  //TODO: different batches validation during registration, review and when editing trough admin
  @Action({
    params: {
      batches: 'array|optional',
      fishStocking: 'number|optional',
    },
  })
  async updateBatches(
    ctx: Context<{
      batches: FishBatch[];
      fishStocking: number;
    }>,
  ) {
    const batches = ctx.params.batches || [];
    const existingBatches = await this.findEntities(ctx, {
      query: { fishStockingId: ctx.params.fishStocking },
    });

    const deleteBatches = filter(
      existingBatches,
      (item: FishBatch) => !batches.some((b) => b.id === item.id),
    );
    const promises = map(deleteBatches, (batch: FishBatch) => this.removeEntity(ctx, batch));
    await Promise.all(promises);

    const updateOrCreatePromises = map(batches, (batch: FishBatch) => {
      if (batch.id) {
        return this.updateEntity(ctx, batch);
      }
      return this.createEntity(ctx, {
        ...batch,
        fishStocking: ctx.params.fishStocking,
      });
    });
    await Promise.all(updateOrCreatePromises);

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
}
