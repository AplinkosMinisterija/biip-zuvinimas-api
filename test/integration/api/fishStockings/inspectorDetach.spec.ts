'use strict';
// Regression: detaching the assigned inspector (officer) must clear it to NULL,
// not coerce it to `{}`. @moleculer/database turns a null value for an object
// field that declares `properties` into `{}` during write validation, which the
// admin UI then renders as "undefined undefined". updateFishStocking clears via
// a raw $set update to write a real NULL instead.

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

function registerPayload() {
  return {
    eventTime: new Date(Date.now() + 5 * 86400000).toISOString(),
    phone: '+37060000000',
    assignedTo: apiHelper.ownerA.appUserId,
    location: {
      cadastral_id: '12345',
      name: 'Test pond',
      municipality: { id: 1, name: 'Test municipality' },
    },
    geom: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [25.0, 55.0] }, properties: {} },
      ],
    },
    batches: [{ fishType: apiHelper.fishTypeId, fishAge: apiHelper.fishAgeId, amount: 100 }],
    fishOrigin: 'GROWN',
    fishOriginCompanyName: 'TestCompany',
  };
}

describe('fishStockings inspector detach', () => {
  let fishStockingId: number;
  let officerId: number;

  beforeAll(async () => {
    const officer = apiHelper.authStore.addUser({
      type: 'ADMIN',
      firstName: 'Insp',
      lastName: 'Ector',
      phone: '+37060000009',
      municipalities: [1],
    });
    officerId = officer.id;

    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/fishStockings/register')
      .set(
        apiHelper.headers({ token: apiHelper.ownerA.token, profile: apiHelper.tenantA.tenantId }),
      )
      .send(registerPayload());
    expect(res.status).toBe(200);
    fishStockingId = Number(res.body.id);
  });

  it('assigns the officer -> inspector populated', async () => {
    const res = await request(apiService.server)
      .patch(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }))
      .send({ inspector: officerId });
    expect(res.status).toBe(200);
    expect(res.body.inspector).toMatchObject({ firstName: 'Insp', organization: 'AAD' });
  });

  it('detaches the officer -> inspector is null, not {}', async () => {
    const res = await request(apiService.server)
      .patch(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }))
      .send({ inspector: null });
    expect(res.status).toBe(200);
    expect(res.body.inspector ?? null).toBeNull();

    // confirm it persisted
    const get = await request(apiService.server)
      .get(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }))
      .expect(200);
    expect(get.body.inspector ?? null).toBeNull();
  });
});
