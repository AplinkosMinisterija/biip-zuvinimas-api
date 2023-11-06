'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

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

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type FishAge<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishAges',
  mixins: [
    DbConnection({
      collection: 'fishAges',
      createActions: {
        createMany: false,
      },
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      label: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    actions: {
      remove: {
        types: [RestrictionType.ADMIN],
      },
      create: {
        types: [RestrictionType.ADMIN],
      },
      update: {
        types: [RestrictionType.ADMIN],
      },
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FishAgesService extends moleculer.Service {
  @Method
  async seedDB() {
    const data = [
      { label: 'Paauginti jaunikliai' },
      { label: 'Vasariniai šiųmetukai' },
      { label: 'Šiųmetukai' },
      { label: 'Lervutės' },
      { label: 'Metinukai' },
      { label: 'Dvivasariai' },
      { label: 'Įvairiaamžiai' },
      { label: 'Trivasariai' },
      { label: 'Reproduktoriai' },
    ];
    await this.createEntities(null, data);
  }
}
