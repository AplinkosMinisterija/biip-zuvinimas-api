'use strict';
// A resubmit must not duplicate, while repeated stockings stay unrestricted.

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
    batches: [
      {
        fishType: apiHelper.fishTypeId,
        fishAge: apiHelper.fishAgeId,
        amount: 100,
      },
    ],
    fishOrigin: 'GROWN',
    fishOriginCompanyName: 'TestCompany',
    ...extra,
  };
}

function register(payload: any) {
  return request(apiService.server)
    .post('/zuvinimasnew/api/fishStockings/register')
    .set(
      apiHelper.headers({
        token: apiHelper.ownerA.token,
        profile: apiHelper.tenantA.tenantId,
      }),
    )
    .send(payload);
}

describe('fishStockings duplicate registration', () => {
  it('returns the existing stocking when the same form is submitted twice', async () => {
    const payload = registerPayload();

    const first = await register(payload);
    expect(first.status).toBe(200);

    const second = await register(payload);
    expect(second.status).toBe(200);
    expect(Number(second.body.id)).toBe(Number(first.body.id));
  });

  it('does not duplicate the batches of the returned stocking', async () => {
    const payload = registerPayload({
      eventTime: new Date(Date.now() + 6 * 86400000).toISOString(),
    });

    await register(payload);
    const second = await register(payload);

    expect(second.body.batches).toHaveLength(1);
    expect(second.body.batches[0].amount).toBe(100);
  });

  it('allows the same water body to be stocked again at another time', async () => {
    const first = await register(
      registerPayload({ eventTime: new Date(Date.now() + 7 * 86400000).toISOString() }),
    );
    const second = await register(
      registerPayload({ eventTime: new Date(Date.now() + 14 * 86400000).toISOString() }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Number(second.body.id)).not.toBe(Number(first.body.id));
  });

  it('allows the same water body and time when the fish differ', async () => {
    const eventTime = new Date(Date.now() + 9 * 86400000).toISOString();

    const first = await register(registerPayload({ eventTime }));
    const second = await register(
      registerPayload({
        eventTime,
        batches: [{ fishType: apiHelper.fishTypeId, fishAge: apiHelper.fishAgeId, amount: 250 }],
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Number(second.body.id)).not.toBe(Number(first.body.id));
  });

  it('still matches when the same batches arrive in another order', async () => {
    const eventTime = new Date(Date.now() + 10 * 86400000).toISOString();
    const batch = (amount: number) => ({
      fishType: apiHelper.fishTypeId,
      fishAge: apiHelper.fishAgeId,
      amount,
    });

    const first = await register(registerPayload({ eventTime, batches: [batch(100), batch(200)] }));
    const second = await register(
      registerPayload({ eventTime, batches: [batch(200), batch(100)] }),
    );

    expect(Number(second.body.id)).toBe(Number(first.body.id));
  });

  it('allows another water body at the same time', async () => {
    const eventTime = new Date(Date.now() + 8 * 86400000).toISOString();

    const first = await register(registerPayload({ eventTime }));
    const second = await register(
      registerPayload({
        eventTime,
        location: {
          cadastral_id: '54321',
          name: 'Other pond',
          municipality: { id: 1, name: 'Test municipality' },
        },
      }),
    );

    expect(Number(second.body.id)).not.toBe(Number(first.body.id));
  });
});
