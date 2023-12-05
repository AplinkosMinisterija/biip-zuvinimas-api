'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import { RestrictionType, Table } from '../types';
import { FishAge } from './fishAges.service';
import { FishStockingStatus } from './fishStockings.service';
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
  async getPublicItems(ctx: Context<{ query: any }>) {
    ctx.params.query = ctx.params.query || {};

    if (typeof ctx.params.query === 'string') {
      try {
        ctx.params.query = JSON.parse(ctx.params.query);
      } catch (err) {}
    }

    ctx.params.query.status = ctx.params?.query?.status || {
      $in: [FishStockingStatus.ONGOING, FishStockingStatus.UPCOMING],
    };

    if (ctx.params?.query?.municipalityId) {
      const municipalityIds = !!ctx?.params?.query?.municipalityId?.$in
        ? ctx.params.query.municipalityId.$in
        : [ctx.params.query.municipalityId];

      ctx.params.query.$raw = {
        condition: `"location"::jsonb->'municipality'->>'id' IN (${municipalityIds
          .map((_: any) => '?')
          .join(',')})`,
        bindings: [...municipalityIds],
      };

      delete ctx.params?.query?.municipalityId;
    }

    if (ctx.params?.query?.cadastralId) {
      const cadastralIds = !!ctx?.params?.query?.cadastralId?.$in
        ? ctx.params.query.cadastralId.$in
        : [ctx.params.query.cadastralId];
      const queryPart = cadastralIds.map((_: any) => '?').join(',');

      if (!ctx.params.query.$raw) {
        ctx.params.query.$raw = {
          condition: `"location"::jsonb->>'cadastral_id' IN (${queryPart})`,
          bindings: [...cadastralIds],
        };
      } else {
        ctx.params.query.$raw.condition += ` AND "location"::jsonb->>'cadastral_id' IN  (${queryPart})`;
        ctx.params.query.$raw.bindings = [...ctx.params.query.$raw.bindings, ...cadastralIds];
      }

      delete ctx.params?.query?.cadastralId;
    }

    return ctx.call('publishing.fishStockings.list', {
      ...(ctx.params || {}),
      sort: 'eventTime',
    });
  }
}
