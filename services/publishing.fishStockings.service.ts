'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import { RestrictionType, Table } from '../types';
import { FishAge } from './fishAges.service';
import { FishType } from './fishTypes.service';

interface Fields {
  id: number;
  eventTime: Date;
  geom: any;
  location: {
    name: string;
    area: number;
    cadastral_id: string;
    municipality: {
      id: number;
      name: string;
    };
  };
  fishes: {
    fish_type: FishType<never, 'id' | 'label'>;
    fish_age: FishAge<never, 'id' | 'label'>;
    count: number;
    weight: number;
  };
}

interface Populates {}

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
