'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
} from '../types';

const Cron = require('@r2d2bzh/moleculer-cron');

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type FishType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishTypes',
  mixins: [
    DbConnection({
      collection: 'fishTypes',
      createActions: {
        createMany: false,
      },
    }),
    Cron,
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      label: 'string|required',
      priority: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  actions: {
    remove: {
      auth: RestrictionType.ADMIN,
    },
    create: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      auth: RestrictionType.ADMIN,
    },
  },
  crons: [
    {
      name: 'updatePriority',
      cronTime: '0 0 * * 0',
      async onTick() {
        return await this.call('fishTypes.updatePriority');
      },
      timeZone: 'Europe/Vilnius',
    },
  ],
  hooks: {
    before: {
      list: ['sortItems'],
      find: ['sortItems'],
      all: ['sortItems'],
    },
  },
})
export default class FishTypesService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/fishTypes',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
  })
  getPublicItems(ctx: Context) {
    return this.findEntities(ctx, {
      fields: ['id', 'label'],
      sort: 'label',
    });
  }

  @Method
  async seedDB() {
    await this.createEntities(null, [
      { label: 'baltieji amūrai' },
      { label: 'karosai, auksiniai' },
      { label: 'lynai' },
      { label: 'karosai, sidabriniai' },
      { label: 'lydekos' },
      { label: 'sykai' },
      { label: 'karpiai' },
      { label: 'seliavos' },
      { label: 'plačiakačiai' },
      { label: 'sterkai' },
      { label: 'karšiai' },
      { label: 'šamai' },
      { label: 'vaivorykštiniai upėtakiai' },
      { label: 'unguriai' },
      { label: 'vėgėlės' },
      { label: 'vėžiai, plačiažnypliai' },
      { label: 'margieji plačiakačiai' },
      { label: 'lašišos' },
      { label: 'šlakiai' },
      { label: 'margieji upėtakiai' },
      { label: 'aštriašnipiai eršketai' },
      { label: 'kiršliai' },
      { label: 'ūsoriai' },
      { label: 'skersnukiai' },
      { label: 'plačiakakčiai' },
      { label: 'margieji plačiakakčiai' },
    ]);
  }

  @Method
  async sortItems(ctx: Context<any>) {
    ctx.params.sort = ctx.params.sort || '-priority,label';
  }

  @Action()
  async updatePriority(ctx: Context) {
    console.log('update priority');
    const fishTypes: FishType[] = await this.findEntities(ctx);
    for (const fishType of fishTypes) {
      const fishBatchesCount: number = await ctx.call('fishBatches.count', {
        query: {
          fishType: fishType.id,
        },
      });
      await this.updateEntity(ctx, { id: fishType.id, priority: fishBatchesCount });
    }
  }
}
