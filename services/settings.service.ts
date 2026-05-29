'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

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
import { UserAuthMeta } from './api.service';

interface Fields extends CommonFields {
  id: number;
  minTimeTillFishStocking: number;
  maxTimeForRegistration: number;
}

interface Populates extends CommonPopulates {}

export type Setting<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'settings',
  mixins: [
    DbConnection({
      createActions: {
        create: false,
        createMany: false,
        list: false,
        update: false,
        all: false,
      },
    }),
  ],
  settings: {
    auth: RestrictionType.ADMIN,
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      minTimeTillFishStocking: 'number',
      maxTimeForRegistration: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  actions: {
    find: {
      auth: RestrictionType.DEFAULT,
    },
    get: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class SettingsService extends moleculer.Service {
  // Settings are global and change a few times a year. fishStockings list
  // hits this twice per request (status filter + status virtual field).
  // TTL kept short (5 min) as a safety net: `maxTimeForRegistration` is
  // baked into status SQL templates, so a missed invalidation would produce
  // wrong status filtering for up to TTL seconds.
  @Action({
    rest: 'GET /',
    auth: RestrictionType.DEFAULT,
    cache: { ttl: 5 * 60 },
  })
  async getSettings(ctx: Context<null, UserAuthMeta>) {
    const settings = await this.findEntities(ctx);
    return {
      minTimeTillFishStocking: settings[0]?.minTimeTillFishStocking,
      maxTimeForRegistration: settings[0]?.maxTimeForRegistration,
    };
  }

  @Event()
  async 'settings.*'() {
    await this.broker.cacher?.clean('settings.**');
  }

  @Action({
    rest: 'PATCH /',
    auth: RestrictionType.ADMIN,
    params: {
      minTimeTillFishStocking: 'number',
      maxTimeForRegistration: 'number',
    },
  })
  async updateSettings(
    ctx: Context<
      {
        minTimeTillFishStocking: 'number';
        maxTimeForRegistration: 'number';
      },
      UserAuthMeta
    >,
  ) {
    const settings = await this.findEntities(ctx);

    return this.updateEntity(ctx, {
      id: settings[0].id,
      ...ctx.params,
    });
  }
  @Method
  async seedDB() {
    const data = [
      {
        minTimeTillFishStocking: 1,
        maxTimeForRegistration: 10,
      },
    ];
    await this.createEntities(null, data);
  }
}
