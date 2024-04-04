'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import { FishAge } from './fishAges.service';
import { FishType } from './fishTypes.service';

export interface FishStockingsCompleted {
  id: number;
  eventTime: Date;
  reviewTime: Date;
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
  fishBatches: {
    fish_type: FishType<never, 'id' | 'label'>;
    fish_age: FishAge<never, 'id' | 'label'>;
    count: number;
    weight: number;
  };
}

//TODO: might be unnecessary if fishBatches refactored
@Service({
  name: 'fishStockingsCompleted',
  mixins: [
    DbConnection({
      collection: 'fishStockingsCompleted',
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
      date: {
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
    },
    defaultPopulates: ['geom'],
  },
})
export default class PublishingFishStockingsService extends moleculer.Service {}
