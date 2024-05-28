'use strict';

import moleculer, { Context } from 'moleculer';
import { Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { RestrictionType } from '../types';
import { UserAuthMeta } from './api.service';
import { FishStocking } from './fishStockings.service';

const mapItem = (data: RecentLocation) => {
  const { cadastralId, ...rest } = data;
  return { ...rest, cadastral_id: cadastralId };
};

export interface RecentLocation {
  name: string;
  cadastralId: string;
  municipality: {
    id: number;
    name: string;
  };
  geom: any;
}

@Service({
  name: 'recentLocations',
  mixins: [
    DbConnection({
      createActions: {
        create: false,
        update: false,
        remove: false,
        createMany: false,
      },
    }),
  ],
  settings: {
    auth: RestrictionType.USER,
    fields: {
      name: 'string',
      cadastralId: 'string',
      municipality: {
        type: 'object',
        properties: {
          id: 'number|integer|positive',
          name: 'string',
        },
      },
      geom: {
        type: 'any',
        populate: async (ctx: Context, _values: any, entities: RecentLocation[]) => {
          const fishStockingIds = entities.map((entity) => entity.geom);
          const fishStockings: FishStocking[] = await ctx.call('fishStockings.find', {
            query: {
              id: { $in: fishStockingIds },
            },
            scope: false,
            populate: ['geom'],
          });
          return entities.map((entity) => fishStockings.find((f) => f.id === entity.geom)?.geom);
        },
      },
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        required: true,
        immutable: true,
        hidden: 'byDefault',
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        required: true,
        immutable: true,
        hidden: 'byDefault',
      },
    },
    scopes: {
      profile(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user, profile } = ctx.meta;
        if (!user?.id) return query;
        query.user = user.id;
        query.tenant = profile ? profile : { $exists: false };
        return query;
      },
    },
    defaultScopes: ['profile'],
    defaultPopulates: ['geom'],
  },
  hooks: {
    after: {
      list: 'afterSelect',
      find: 'afterSelect',
      get: 'afterSelect',
    },
  },
})
export default class RecentLocationsService extends moleculer.Service {
  @Method
  async afterSelect(ctx: any, data: any) {
    if (Array.isArray(data)) {
      return data.map((item: RecentLocation) => {
        return mapItem(item);
      });
    } else if (data?.rows) {
      return {
        ...data,
        rows: data.rows.map((item: RecentLocation) => {
          return mapItem(item);
        }),
      };
    } else if (data?.cadastralId) {
      return mapItem(data);
    }
  }
}
