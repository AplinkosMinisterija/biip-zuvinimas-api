'use strict';
// Notifications run after the record is already written, so they must not fail the request.

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
      cadastral_id: '98765',
      name: 'Notification pond',
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

async function whileFailing(actionName: string, fn: () => Promise<void>) {
  const endpoint = apiHelper.broker.findNextActionEndpoint(actionName) as any;
  const original = endpoint.action.handler;
  endpoint.action.handler = async () => {
    throw new Error(`${actionName} is down`);
  };
  try {
    await fn();
  } finally {
    endpoint.action.handler = original;
  }
}

describe('fishStockings notification failures', () => {
  it('registers the stocking even when the municipality lookup fails', async () => {
    await whileFailing('auth.permissions.getUsersByAccess', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/fishStockings/register')
        .set(
          apiHelper.headers({ token: apiHelper.ownerA.token, profile: apiHelper.tenantA.tenantId }),
        )
        .send(registerPayload());

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();

      const get = await request(apiService.server)
        .get(`/zuvinimasnew/api/fishStockings/${res.body.id}`)
        .set(
          apiHelper.headers({ token: apiHelper.ownerA.token, profile: apiHelper.tenantA.tenantId }),
        )
        .expect(200);
      expect(get.body.location.name).toBe('Notification pond');
    });
  });

  it('assigns the officer even when the notification email fails', async () => {
    const officer = apiHelper.authStore.addUser({
      type: 'ADMIN',
      firstName: 'Mail',
      lastName: 'Down',
      phone: '+37060000008',
      municipalities: [1],
    });

    const registered = await request(apiService.server)
      .post('/zuvinimasnew/api/fishStockings/register')
      .set(
        apiHelper.headers({ token: apiHelper.ownerA.token, profile: apiHelper.tenantA.tenantId }),
      )
      .send({
        ...registerPayload(),
        eventTime: new Date(Date.now() + 6 * 86400000).toISOString(),
      });
    expect(registered.status).toBe(200);
    const fishStockingId = Number(registered.body.id);

    await whileFailing('mail.sendFishStockingAssignedEmail', async () => {
      const res = await request(apiService.server)
        .patch(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
        .set(apiHelper.headers({ token: apiHelper.admin.token }))
        .send({ inspector: officer.id });

      expect(res.status).toBe(200);
      expect(res.body.inspector).toMatchObject({ firstName: 'Mail', organization: 'AAD' });
    });

    const get = await request(apiService.server)
      .get(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }))
      .expect(200);
    expect(get.body.inspector).toMatchObject({ firstName: 'Mail' });
  });
});
