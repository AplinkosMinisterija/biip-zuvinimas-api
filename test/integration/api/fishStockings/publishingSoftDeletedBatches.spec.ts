'use strict';
// Regression test for the publishing views aggregating soft-deleted batches.
//
// Editing a registered stocking soft-deletes the old fish_batches row and
// inserts a new one. The `publishing.fishStockings` view aggregated every row
// for the stocking, deleted ones included, so each edit added another duplicate
// entry to the public payload. Production stocking 4530 reached ten identical
// "sterkai" entries while the database held a single batch.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();
});
afterAll(async () => {
  await apiHelper.stop();
});

function registerPayload(extra: any = {}) {
  return {
    eventTime: new Date(Date.now() + 5 * 86400000).toISOString(),
    phone: '+37060000000',
    assignedTo: apiHelper.ownerA.appUserId,
    location: {
      cadastral_id: '54321',
      name: 'Soft delete pond',
      municipality: { id: 1, name: 'Test municipality' },
    },
    geom: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [25.1, 55.1] }, properties: {} },
      ],
    },
    batches: [{ fishType: apiHelper.fishTypeId, fishAge: apiHelper.fishAgeId, amount: 100 }],
    fishOrigin: 'GROWN',
    fishOriginCompanyName: 'TestCompany',
    ...extra,
  };
}

function ownerHeaders() {
  return apiHelper.headers({
    token: apiHelper.ownerA.token,
    profile: apiHelper.tenantA.tenantId,
  });
}

async function publishedFishes(fishStockingId: number) {
  const res = await request(apiService.server)
    .get('/zuvinimasnew/api/public/fishStockings/upcoming')
    .query({ pageSize: 100 });
  expect(res.status).toBe(200);
  const row = res.body.rows.find((r: any) => Number(r.id) === fishStockingId);
  expect(row).toBeDefined();
  return row.fishes;
}

describe('publishing.fishStockings excludes soft-deleted batches', () => {
  let fishStockingId: number;

  it('registers a stocking with a single batch', async () => {
    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/fishStockings/register')
      .set(ownerHeaders())
      .send(registerPayload());

    expect(res.status).toBe(200);
    fishStockingId = Number(res.body.id);

    expect(await publishedFishes(fishStockingId)).toHaveLength(1);
  });

  it('still publishes a single entry after repeated edits soft-delete the batch', async () => {
    // Each edit omits the existing batch id, so the service soft-deletes the old
    // row and inserts a replacement — exactly what produced the production data.
    for (const amount of [200, 300, 400]) {
      const res = await request(apiService.server)
        .patch(`/zuvinimasnew/api/fishStockings/register/${fishStockingId}`)
        .set(ownerHeaders())
        .send(
          registerPayload({
            batches: [{ fishType: apiHelper.fishTypeId, fishAge: apiHelper.fishAgeId, amount }],
          }),
        );
      expect(res.status).toBe(200);
    }

    const fishes = await publishedFishes(fishStockingId);
    expect(fishes).toHaveLength(1);
    expect(fishes[0].count).toBe(400);
  });

  it('publishes an array, never null, when a stocking has no live batches', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/public/fishStockings/upcoming')
      .query({ pageSize: 100 });

    expect(res.status).toBe(200);
    for (const row of res.body.rows) {
      expect(Array.isArray(row.fishes)).toBe(true);
    }
  });
});
