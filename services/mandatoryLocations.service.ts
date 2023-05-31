'use strict';

import moleculer, { Context } from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import { keys, map } from 'lodash';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';

const mandatoryAreas = [
  12230311, 15050130, 20050142, 10030094, 12250300, 12250132, 10050218,
  41040030, 15050156, 16050142, 10030327, 10030314, 12130427, 12131313,
  10030329, 11030062, 15050157, 12250112, 12030530, 12231948, 20050032,
  12131329, 11030146, 15050004, 13050241, 12250190, 14050051, 12231655,
  16050213, 17050220, 30050121, 12140445, 12242178, 12131317, 11050091,
  12130212, 12250002, 12030090, 11050040, 10030379, 13050231, 11050111,
  12232142, 12230992, 17050174, 30050186, 10050050, 12240991, 12230993,
  12240994, 12230318, 12030400,
];

interface Fields extends CommonFields {
  id: number;
  location: object;
}

interface Populates extends CommonPopulates {}

export type FishType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'mandatoryLocations',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      location: 'object|required',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  hooks: {
    before: {
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      findOne: ['beforeSelect'],
      count: ['beforeSelect'],
      all: ['beforeSelect'],
      remove: ['beforeDelete'],
    },
  },
})
export default class FishTypesService extends moleculer.Service {
  @Method
  async beforeSelect(ctx: Context<any>) {
    if (!ctx.params.filter) {
      return ctx;
    }
    const filters =
      typeof ctx.params.filter === 'string'
        ? JSON.parse(ctx.params.filter)
        : ctx.params.filter;
    const filterTypes = keys(filters);
    let condition = '';
    for (const filterType of filterTypes) {
      if (
        ['name', 'cadastral_id', 'municipality'].some(
          (key) => key === filterType,
        )
      ) {
        const partialCondition = `"location"::jsonb->>'${filterType}' ilike '%${filters[filterType]}%'`;
        if (condition) {
          condition += ` AND ${partialCondition}`;
        } else {
          condition += partialCondition;
        }
      }
    }

    ctx.params = {
      ...ctx.params,
      query: {
        $raw: {
          condition,
        },
      },
    };
    return ctx;
  }

  @Method
  async seedDB() {
    const result: any[] = [];
    for (const mandatoryLocation of mandatoryAreas) {
      const url =
        `${process.env.INTERNAL_API}/uetk/search?` +
        new URLSearchParams({ search: `${mandatoryLocation}` });

      const response = await fetch(url);

      const data = await response.json();

      const locations = map(data.rows, (item) => {
        const location: any = {
          location: {
            cadastral_id: item.properties.cadastral_id,
            name: item.properties.name,
            municipality: item.properties.municipality,
            area: item.properties.area,
          },
        };
        return location;
      });
      if (locations[0]) {
        result.push(locations[0]);
      }
    }
    await this.createEntities(null, result);
  }
}
