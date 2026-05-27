'use strict';
// Regression tests for the authorization fixes in PR #93:
//   #5  settings.updateSettings auth bypass
//   #6  fishStockingPhotos BOLA
//   #7  users.byTenant → ADMIN only
//   #8  fishBatches.* visibility:'protected'
//   #8b tenantUsers update/remove cross-tenant escalation
//   #10 minio.* visibility:'protected'
//   #11 tenantUsers.invite cross-tenant OWNER injection

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

describe('Authorization regression', () => {
  describe('settings (CRIT #5)', () => {
    const url = '/zuvinimasnew/api/settings/';

    it('any USER can GET settings', async () => {
      await request(apiService.server)
        .get(url)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .expect(200);
    });

    it('USER cannot PATCH settings', async () => {
      await request(apiService.server)
        .patch(url)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({ minTimeTillFishStocking: -1, maxTimeForRegistration: 999 })
        .expect(401);
    });

    it('ADMIN can PATCH settings', async () => {
      await request(apiService.server)
        .patch(url)
        .set(apiHelper.headers({ token: apiHelper.admin.token }))
        .send({ minTimeTillFishStocking: 2, maxTimeForRegistration: 15 })
        .expect(200);
    });

    it('SUPER_ADMIN can PATCH settings', async () => {
      await request(apiService.server)
        .patch(url)
        .set(apiHelper.headers({ token: apiHelper.superAdmin.token }))
        .send({ minTimeTillFishStocking: 1, maxTimeForRegistration: 10 })
        .expect(200);
    });
  });

  describe('users.byTenant (HIGH #7)', () => {
    it('USER blocked', async () => {
      await request(apiService.server)
        .get(`/zuvinimasnew/api/users/byTenant/${apiHelper.tenantB.tenantId}`)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .expect(401);
    });

    it('ADMIN allowed', async () => {
      const res = await request(apiService.server)
        .get(`/zuvinimasnew/api/users/byTenant/${apiHelper.tenantA.tenantId}`)
        .set(apiHelper.headers({ token: apiHelper.admin.token }))
        .expect(200);
      expect(Array.isArray(res.body.rows)).toBe(true);
    });
  });

  describe('fishBatches.* (HIGH #8 — visibility:protected)', () => {
    it('POST /api/fishBatches/createBatches → 404 (not HTTP-exposed)', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/fishBatches/createBatches')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({ batches: [], fishStocking: 1 });
      expect([404, 503]).toContain(res.status);
    });

    it('POST /api/fishBatches/updateBatches → 404', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/fishBatches/updateBatches')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({ batches: [], fishStocking: 1 });
      expect([404, 503]).toContain(res.status);
    });

    it('GET /api/fishBatches → 404 (built-in find is protected)', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishBatches')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        );
      expect([404, 503]).toContain(res.status);
    });
  });

  describe('minio.* (CRIT #10 — visibility:protected)', () => {
    it('POST /api/minio/fPutObject → 404', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/minio/fPutObject')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({ bucketName: 'x', objectName: 'y', filePath: '/etc/passwd' });
      expect([404, 503]).toContain(res.status);
    });

    it('POST /api/minio/getObject → 404', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/minio/getObject')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({ bucketName: 'x', objectName: 'y' });
      expect([404, 503]).toContain(res.status);
    });

    it('POST /api/minio/removeBucket → 404', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/minio/removeBucket')
        .set(apiHelper.headers({ token: apiHelper.admin.token }))
        .send({ bucketName: 'x' });
      expect([404, 503]).toContain(res.status);
    });
  });

  describe('tenantUsers.invite (CRIT #11 — cross-tenant OWNER injection)', () => {
    it('OWNER of tenant A cannot invite into tenant B', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/tenantUsers/invite')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({
          tenant: apiHelper.tenantB.tenantId,
          role: 'OWNER',
          firstName: 'Attacker',
          lastName: 'X',
          personalCode: '99988877766',
          email: 'attacker@example.com',
        });
      expect(res.status).toBe(401);
    });

    it('OWNER of tenant A CAN invite into tenant A (own tenant)', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/tenantUsers/invite')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        )
        .send({
          tenant: apiHelper.tenantA.tenantId,
          role: 'USER',
          firstName: 'New',
          lastName: 'Member',
          personalCode: '38501010101',
          email: 'newmember@example.com',
        });
      expect([200, 422]).toContain(res.status); // 200 success, 422 = already exists
    });

    it('ADMIN can invite into any tenant', async () => {
      const res = await request(apiService.server)
        .post('/zuvinimasnew/api/tenantUsers/invite')
        .set(apiHelper.headers({ token: apiHelper.admin.token }))
        .send({
          tenant: apiHelper.tenantB.tenantId,
          role: 'USER',
          firstName: 'Admin',
          lastName: 'Invited',
          personalCode: '38501010102',
          email: 'admininvited@example.com',
        });
      expect([200, 422]).toContain(res.status);
    });
  });

  describe('tenantUsers.update/remove cross-tenant (HIGH #8b)', () => {
    it('OWNER A cannot remove tenantUser from tenant B', async () => {
      // tenant B has ownerB as OWNER → tenantUser id of that record
      const adapter: any = await apiHelper.broker.getLocalService('users').getAdapter();
      const row = await adapter.client('tenant_users')
        .where({ tenant_id: apiHelper.tenantB.tenantId, user_id: apiHelper.ownerB.appUserId })
        .first();
      expect(row).toBeDefined();

      const res = await request(apiService.server)
        .delete(`/zuvinimasnew/api/tenantUsers/${row.id}`)
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        );
      expect(res.status).toBe(401);
    });
  });
});
