'use strict';
// Regression: admin actions left createdBy/updatedBy/deletedBy NULL because
// api.service resolves `ctx.meta.user` only for authUser.type === USER, so the
// COMMON_FIELDS hooks had no id to write. Admins are now mirrored into a local
// `users` row (type ADMIN) purely to fill those audit columns.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../helpers/api';

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

async function knexClient() {
  const usersService: any = apiHelper.broker.getLocalService('users');
  const adapter: any = await usersService.getAdapter();
  return adapter.client;
}

async function createTenantUser(tenantId: number, email: string) {
  const authUser = apiHelper.authStore.addUser({
    type: 'USER',
    firstName: 'Audit',
    lastName: 'Target',
    email,
  });
  const user: any = await apiHelper.broker.call('users.create', {
    authUser: authUser.id,
    firstName: 'Audit',
    lastName: 'Target',
    email,
  });
  const tenantUser: any = await apiHelper.broker.call('tenantUsers.create', {
    tenant: tenantId,
    user: user.id,
    role: 'USER',
  });

  return { userId: Number(user.id), tenantUserId: Number(tenantUser.id) };
}

describe('audit columns', () => {
  it('fills deletedBy with the admin local user when an admin removes a row', async () => {
    const { tenantUserId } = await createTenantUser(
      apiHelper.tenantA.tenantId,
      'audit.admin.delete@example.com',
    );

    const res = await request(apiService.server)
      .delete(`/zuvinimasnew/api/tenantUsers/${tenantUserId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }));

    expect(res.statusCode).toBe(200);

    const knex = await knexClient();
    const row = await knex('tenant_users').where({ id: tenantUserId }).first();

    expect(row.deletedAt).not.toBeNull();
    expect(Number(row.deletedBy)).toBe(apiHelper.admin.appUserId);
  });

  it('creates a local ADMIN row for an admin that has none yet', async () => {
    const { tenantUserId } = await createTenantUser(
      apiHelper.tenantA.tenantId,
      'audit.fresh.admin@example.com',
    );

    const freshAuthAdmin = apiHelper.authStore.addUser({
      type: 'ADMIN',
      firstName: 'Fresh',
      lastName: 'Admin',
      email: 'fresh.admin@am.lt',
      municipalities: [1],
    });

    const knex = await knexClient();
    const before = await knex('users').where({ authUserId: freshAuthAdmin.id }).first();
    expect(before).toBeUndefined();

    const res = await request(apiService.server)
      .patch(`/zuvinimasnew/api/tenantUsers/${tenantUserId}`)
      .set(apiHelper.headers({ token: apiHelper.authStore.issueToken(freshAuthAdmin.id) }))
      .send({ role: 'USER_ADMIN' });

    expect(res.statusCode).toBe(200);

    const mirrored = await knex('users').where({ authUserId: freshAuthAdmin.id }).first();
    expect(mirrored).toBeDefined();
    expect(mirrored.type).toBe('ADMIN');
    expect(mirrored.email).toBeNull();
    expect(mirrored.phone).toBeNull();

    const row = await knex('tenant_users').where({ id: tenantUserId }).first();
    expect(Number(row.updatedBy)).toBe(Number(mirrored.id));
  });

  it('still writes the acting USER id, not an admin mirror', async () => {
    const { tenantUserId } = await createTenantUser(
      apiHelper.tenantA.tenantId,
      'audit.owner.delete@example.com',
    );

    const res = await request(apiService.server)
      .delete(`/zuvinimasnew/api/tenantUsers/${tenantUserId}`)
      .set(
        apiHelper.headers({
          token: apiHelper.ownerA.token,
          profile: apiHelper.tenantA.tenantId,
        }),
      );

    expect(res.statusCode).toBe(200);

    const knex = await knexClient();
    const row = await knex('tenant_users').where({ id: tenantUserId }).first();

    expect(Number(row.deletedBy)).toBe(apiHelper.ownerA.appUserId);
  });

  it('mirrors the admin while writing to the users service itself', async () => {
    const { userId } = await createTenantUser(
      apiHelper.tenantA.tenantId,
      'audit.user.update@example.com',
    );

    const nestedAuthAdmin = apiHelper.authStore.addUser({
      type: 'ADMIN',
      firstName: 'Nested',
      lastName: 'Admin',
      email: 'nested.admin@am.lt',
      municipalities: [1],
    });

    const res = await request(apiService.server)
      .patch(`/zuvinimasnew/api/users/${userId}`)
      .set(apiHelper.headers({ token: apiHelper.authStore.issueToken(nestedAuthAdmin.id) }))
      .send({ phone: '+37060000123' });

    expect(res.statusCode).toBe(200);

    const knex = await knexClient();
    const mirrored = await knex('users').where({ authUserId: nestedAuthAdmin.id }).first();
    const row = await knex('users').where({ id: userId }).first();

    expect(mirrored.type).toBe('ADMIN');
    expect(Number(row.updatedBy)).toBe(Number(mirrored.id));
  });

  it('still lets an admin open a single user', async () => {
    const res = await request(apiService.server)
      .get(`/zuvinimasnew/api/users/${apiHelper.userA.appUserId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }));

    expect(res.statusCode).toBe(200);
    expect(Number(res.body.id)).toBe(apiHelper.userA.appUserId);
  });

  it('does not expose mirrored admins in the users list', async () => {
    const res = await request(apiService.server)
      .get('/zuvinimasnew/api/users')
      .set(apiHelper.headers({ token: apiHelper.admin.token }));

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((user: any) => user.type === 'USER')).toBe(true);
  });
});
