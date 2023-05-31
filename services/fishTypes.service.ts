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
  Table,
} from '../types';

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type FishType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishTypes',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      label: 'string|required',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FishTypesService extends moleculer.Service {
  @Method
  async seedDB() {
    await this.createEntities(null, [
      { label: 'baltieji amūrai' },
      { label: 'karosai, auksiniai' },
      { label: 'lynai' },
      { label: 'karosai, sidabriniai' },
      { label: 'lydekos' },
      { label: 'sykai' },
      { label: 'karpiai' },
      { label: 'seliavos' },
      { label: 'plačiakačiai' },
      { label: 'sterkai' },
      { label: 'karšiai' },
      { label: 'šamai' },
      { label: 'vaivorykštiniai upėtakiai' },
      { label: 'unguriai' },
      { label: 'vėgėlės' },
      { label: 'vėžiai, plačiažnypliai' },
      { label: 'margieji plačiakačiai' },
      { label: 'lašišos' },
      { label: 'šlakiai' },
      { label: 'margieji upėtakiai' },
      { label: 'aštriašnipiai eršketai' },
      { label: 'kiršliai' },
      { label: 'ūsoriai' },
      { label: 'skersnukiai' },
      { label: 'plačiakakčiai' },
      { label: 'margieji plačiakakčiai' },
    ]);
  }
}
