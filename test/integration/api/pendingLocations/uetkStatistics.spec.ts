'use strict';
// Regression test: the `NR-` reserved namespace (minted by pendingLocations
// for water bodies UETK does not contain, see Task 3) must never reach the
// UETK-facing statistics endpoints. UETK consumes these endpoints itself, so
// leaking an `NR-` id would hand it an identifier it does not own.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

const UETK_CADASTRAL_ID = '10099999';
const RESERVED_CADASTRAL_ID = 'NR-000001';

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();

  const genuineId = await apiHelper.createCompletedFishStocking({
    location: {
      cadastral_id: UETK_CADASTRAL_ID,
      name: 'Tikras UETK ežeras',
      municipality: { id: 88, name: 'Šilutės r. sav.' },
    },
  });
  const reservedId = await apiHelper.createCompletedFishStocking({
    location: {
      cadastral_id: RESERVED_CADASTRAL_ID,
      name: 'Naikupė',
      municipality: { id: 88, name: 'Šilutės r. sav.' },
    },
  });

  // `createCompletedFishStocking` only inserts the bare fish_stockings row.
  // The `fishStockingsCompleted` view (database/migrations/
  // 20240404063150_completedFishstockingsView.js), which both statistics
  // actions read from, additionally requires a `reviewTime` and a live
  // reviewed batch — add both directly, the same way
  // publishingSoftDeletedBatches.spec.ts does.
  const usersService: any = apiHelper.broker.getLocalService('users');
  const adapter: any = await usersService.getAdapter();
  const knex = adapter.client;

  for (const stockingId of [genuineId, reservedId]) {
    await knex('fishStockings')
      .where('id', stockingId)
      .update({ reviewTime: new Date(Date.now() - 86400000) });
    await knex('fishBatches').insert({
      fishStockingId: stockingId,
      fishTypeId: apiHelper.fishTypeId,
      fishAgeId: apiHelper.fishAgeId,
      amount: 100,
      reviewAmount: 100,
    });
  }
});
afterAll(async () => {
  await apiHelper.stop();
});

describe('public.uetk statistics endpoints exclude the reserved NR- namespace', () => {
  it('never exposes reserved NR- ids through /uetk/statistics, while still returning real UETK ids', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/public/uetk/statistics')
      .expect(200);

    // Asserting the real id is present too means a filter that accidentally
    // drops every row (not just NR-) cannot be mistaken for a passing test.
    expect(res.body[UETK_CADASTRAL_ID]).toBeDefined();
    expect(Object.keys(res.body).filter((k) => k.startsWith('NR-'))).toEqual([]);
  });

  it('never exposes reserved NR- ids through /uetk/statistics/byYear either', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/public/uetk/statistics/byYear')
      .expect(200);

    expect(res.body[UETK_CADASTRAL_ID]).toBeDefined();
    expect(Object.keys(res.body).filter((k) => k.startsWith('NR-'))).toEqual([]);
  });
});
