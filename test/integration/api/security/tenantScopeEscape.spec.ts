'use strict';
// Regression: three ways a tenant USER could read data outside their own tenant.
// All of them merged the caller's `query` INTO the server-built scope with the
// caller spread last, or skipped the scope altogether:
//   1. `users.find`  — `query.$raw` replaced the tenant clause (whole users table).
//   2. `tenantUsers.list` — `query.tenant` replaced the enforced tenant id.
//   3. `tenantUsers.find` — no `beforeSelect` hook at all, so the whole table.

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

function ownerBHeaders() {
  return apiHelper.headers({
    token: apiHelper.ownerB.token,
    profile: apiHelper.tenantB.tenantId,
  });
}

describe('tenant scope escapes', () => {
  it('users.find: a caller-supplied $raw cannot replace the tenant clause', async () => {
    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/users/find')
      .set(ownerBHeaders())
      .send({ query: { $raw: { condition: '1=1', bindings: [] } } });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Only tenant B's own members — not every user in the database.
    expect(res.body.map((user: any) => Number(user.id))).toEqual([apiHelper.ownerB.appUserId]);
  });

  it('users.find: a nested $raw is stripped, not executed as SQL', async () => {
    // A nested `$raw` does not widen the result set, but the knex adapter still
    // runs it verbatim — which is the SQL injection sink. Deliberately broken SQL
    // makes the difference observable: executed => 500, stripped => 200.
    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/users/find')
      .set(ownerBHeaders())
      .send({
        query: { $or: [{ id: { $raw: { condition: 'not valid sql at all', bindings: [] } } }] },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.map((user: any) => Number(user.id))).toEqual([apiHelper.ownerB.appUserId]);
  });

  it('tenantUsers.list: a caller-supplied tenant cannot replace the profile', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/tenantUsers')
      .set(ownerBHeaders())
      .query({ query: JSON.stringify({ tenant: apiHelper.tenantA.tenantId }) });

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(
      res.body.rows.every((row: any) => Number(row.tenant) === apiHelper.tenantB.tenantId),
    ).toBe(true);
  });

  it('tenantUsers.find is not reachable over HTTP', async () => {
    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/tenantUsers/find')
      .set(ownerBHeaders())
      .send({});

    expect(res.statusCode).toBe(404);
  });

  it('tenantUsers.get is admin only', async () => {
    const knex = await (async () => {
      const usersService: any = apiHelper.broker.getLocalService('users');
      const adapter: any = await usersService.getAdapter();
      return adapter.client;
    })();
    const foreignRow = await knex('tenant_users')
      .where({ tenantId: apiHelper.tenantA.tenantId })
      .first();

    const asUser = await request(apiService.server)
      .get(`/zuvinimasnew/api/tenantUsers/${foreignRow.id}`)
      .set(ownerBHeaders());
    expect(asUser.statusCode).toBe(401);

    const asAdmin = await request(apiService.server)
      .get(`/zuvinimasnew/api/tenantUsers/${foreignRow.id}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }));
    expect(asAdmin.statusCode).toBe(200);
  });

  it('a tenant USER still sees their own tenant members', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/tenantUsers')
      .set(
        apiHelper.headers({
          token: apiHelper.ownerA.token,
          profile: apiHelper.tenantA.tenantId,
        }),
      );

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.length).toBe(2);
    expect(
      res.body.rows.every((row: any) => Number(row.tenant) === apiHelper.tenantA.tenantId),
    ).toBe(true);
  });
});
