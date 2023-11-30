'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type PublishingFishStocking<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'publishing.fishStockings',
  mixins: [
    DbConnection({
      collection: 'publishing.fishStockings',
      rest: false,
      createActions: {
        create: false,
        update: false,
        remove: false,
        get: false,
        createMany: false,
        removeAllEntities: false,
      },
    }),
    PostgisMixin({
      srid: 3346,
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },

      eventTime: {
        type: 'date',
        columnType: 'datetime',
      },

      geom: {
        type: 'any',
        geom: {
          type: 'geom',
        },
      },

      location: {
        type: 'object',
        columnType: 'json',
      },

      fishes: {
        type: 'array',
        columnType: 'json',
        items: { type: 'object' },
      },

      status: 'string',
    },

    defaultPopulates: ['geom'],
  },
})
export default class PublishingFishStockingsService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/fishStockings',
      path: '/upcoming',
    },
    auth: RestrictionType.PUBLIC,
  })
  getPublicItems(ctx: Context<{}>) {
    return ctx.call('publishing.fishStockings.list', {
      ...(ctx.params || {}),
      sort: 'eventTime',
    });
  }
}
