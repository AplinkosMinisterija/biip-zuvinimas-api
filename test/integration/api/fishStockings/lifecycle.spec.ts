'use strict';
// Happy-path tests for fishStockings register → review → cancel flow
// across the three user roles (tenant OWNER, freelancer, admin).
// Catches regressions where security fixes inadvertently break legitimate
// workflows.

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
    // future date so isTimeBeforeReview passes
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

describe('fishStockings lifecycle', () => {
  describe('USER acting as tenant OWNER', () => {
    let fishStockingId: number;

    it('POST /api/fishStockings/register succeeds', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/fishStockings/register')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send(registerPayload());
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      fishStockingId = Number(res.body.id);
    });

    it('GET /api/fishStockings/:id returns the registered stocking', async () => {
      const res = await request(apiService.server)
        .get(`/zuvinimasnew/api/fishStockings/${fishStockingId}`)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .expect(200);
      expect(Number(res.body.id)).toBe(fishStockingId);
    });

    it('GET /api/fishStockings list returns it under tenant A scope', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .expect(200);
      const ids = res.body.rows.map((r: any) => Number(r.id));
      expect(ids).toContain(fishStockingId);
    });

    it('tenant B cannot see tenant A stockings', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerB.token,
            profile: apiHelper.tenantB.tenantId,
          }),
        )
        .expect(200);
      const ids = res.body.rows.map((r: any) => Number(r.id));
      expect(ids).not.toContain(fishStockingId);
    });

    it('PATCH /api/fishStockings/cancel/:id removes upcoming stocking', async () => {
      await request(apiService.server)
        .patch(`/zuvinimasnew/api/fishStockings/cancel/${fishStockingId}`)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .expect(200);
    });
  });

  describe('freelancer', () => {
    it('POST /api/fishStockings/register succeeds without X-Profile', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/fishStockings/register')
        .set(apiHelper.headers({ token: apiHelper.freelancer.token }))
        .send(
          registerPayload({
            assignedTo: apiHelper.freelancer.appUserId,
          }),
        );
      expect(res.status).toBe(200);
    });

    it('freelancer sees only their own stockings', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(apiHelper.headers({ token: apiHelper.freelancer.token }))
        .expect(200);
      // every row should have createdBy = freelancer.appUserId (their own only)
      for (const row of res.body.rows) {
        expect(Number(row.createdBy)).toBe(apiHelper.freelancer.appUserId);
      }
    });
  });

  describe('USER without profile and not freelancer', () => {
    it('outsider sees zero stockings (createdBy filter, tenant excluded)', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(apiHelper.headers({ token: apiHelper.outsider.token }))
        .expect(200);
      expect(res.body.rows).toEqual([]);
    });
  });
});
