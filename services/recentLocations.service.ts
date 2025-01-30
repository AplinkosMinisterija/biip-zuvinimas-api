'use strict';

import moleculer, { Context } from 'moleculer';
import { Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { RestrictionType } from '../types';
import { UserAuthMeta } from './api.service';

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
  fishStockingId: number;
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
      area: 'number',
      length: 'number',
      category: 'string',
      fishStockingId: {
        type: 'number',
        columnType: 'integer',
        required: true,
        immutable: true,
        hidden: 'byDefault',
      },
      geom: {
        type: 'any',
        raw: true,
        virtual: true,
        async populate(ctx: any, _values: any, recentLocations: RecentLocation[]) {
          return Promise.all(
            recentLocations.map(async (recentLocation) => {
              return ctx.call('fishStockings.getGeometryJson', {
                field: 'geom',
                asField: 'geom',
                id: recentLocation.fishStockingId,
              });
            }),
          );
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
