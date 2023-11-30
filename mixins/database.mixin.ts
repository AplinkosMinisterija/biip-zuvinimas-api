'use strict';

import _ from 'lodash';
import filtersMixin from 'moleculer-knex-filters';
const DbService = require('@moleculer/database').Service;
const knex = require('../knexfile');

export default function (opts: any = {}) {
  const adapter: any = {
    type: 'Knex',
    options: {
      knex,
      tableName: opts.collection,
    },
  };

  opts = _.defaultsDeep(opts, { adapter, createActions: { replace: false } }, { cache: false });

  const schema = {
    mixins: [DbService(opts), filtersMixin()],

    actions: {
      findOne(ctx: any) {
        return this.findEntity(ctx);
      },
    },

    methods: {
      filterQueryIds(ids: Array<number>, queryIds?: any) {
        if (!queryIds) return ids;

        queryIds = (Array.isArray(queryIds) ? queryIds : [queryIds]).map((id: any) => parseInt(id));

        return ids.filter((id: number) => queryIds.indexOf(id) >= 0);
      },
    },

    merged(schema: any) {
      if (schema.actions) {
        for (const action in schema.actions) {
          const params = schema.actions[action].additionalParams;
          if (typeof params === 'object') {
            schema.actions[action].params = {
              ...schema.actions[action].params,
              ...params,
            };
          }
        }
      }
    },

    async started() {
      // Seeding if the DB is empty
      const count = await this.countEntities(null, {
        scope: false,
      });

      if (count == 0 && _.isFunction(this.seedDB)) {
        this.logger.info(`Seed '${opts.collection}' collection...`);
        await this.seedDB();
      }
    },
  };

  return schema;
}
