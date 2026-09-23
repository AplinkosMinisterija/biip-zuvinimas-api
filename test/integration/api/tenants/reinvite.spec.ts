'use strict';
// Regression: inviting a company again after it was deleted created a SECOND tenant
// row for the same auth group, empty of members — the auth server hands back the
// existing company group, so the old tenant and the new one pointed at one group.
// The deleted tenant is now restored instead, together with the members that the
// tenant-removal cascade took out. Members removed before the deletion (i.e. removed
// deliberately) stay out.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper, TEST_TENANT_A_CODE } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

beforeAll(async () => {
  await apiHelper.start();
});
afterAll(async () => {
  await apiHelper.stop();
});

async function knexClient() {
  const usersService: any = apiHelper.broker.getLocalService('users');
  const adapter: any = await usersService.getAdapter();
  return adapter.client;
}

function adminHeaders() {
  return apiHelper.headers({ token: apiHelper.admin.token });
}

function invitePayload() {
  return {
    companyCode: TEST_TENANT_A_CODE,
    companyName: 'Company A',
    companyPhone: '+37060099991',
    companyEmail: 'companya@example.com',
    companyAddress: 'Vilnius',
  };
}

async function waitForCascade(tenantId: number) {
  const knex = await knexClient();
  for (let i = 0; i < 25; i++) {
    const rows = await knex('tenant_users').where({ tenantId });
    if (rows.length && rows.every((row: any) => row.deletedAt)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('tenant removal cascade did not finish');
}

describe('tenants.invite for a deleted company', () => {
  beforeAll(async () => {
    await apiHelper.setup();
  });

  it('restores the tenant and the members removed with it', async () => {
    const knex = await knexClient();
    const tenantId = apiHelper.tenantA.tenantId;

    // userA is removed deliberately, before the company is deleted.
    const userARow = await knex('tenant_users')
      .where({ tenantId, userId: apiHelper.userA.appUserId })
      .first();
    const removeMember = await request(apiService.server)
      .delete(`/zuvinimasnew/api/tenantUsers/${userARow.id}`)
      .set(adminHeaders());
    expect(removeMember.statusCode).toBe(200);

    // A second apart, so the restore window cannot reach back to it.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const removeTenant = await request(apiService.server)
      .delete(`/zuvinimasnew/api/tenants/${tenantId}`)
      .set(adminHeaders());
    expect(removeTenant.statusCode).toBe(200);
    await waitForCascade(tenantId);

    const reinvite = await request(apiService.server)
      .post('/zuvinimasnew/api/tenants/invite')
      .set(adminHeaders())
      .send(invitePayload());

    expect(reinvite.statusCode).toBe(200);
    // Same row, not a duplicate.
    expect(Number(reinvite.body.id)).toBe(tenantId);

    const tenantRow = await knex('tenants').where({ id: tenantId }).first();
    expect(tenantRow.deletedAt).toBeNull();

    const tenantCount = await knex('tenants')
      .where({ authGroupId: tenantRow.authGroupId })
      .whereNull('deletedAt')
      .count('* as c')
      .first();
    expect(Number(tenantCount.c)).toBe(1);

    const ownerRow = await knex('tenant_users')
      .where({ tenantId, userId: apiHelper.ownerA.appUserId })
      .first();
    expect(ownerRow.deletedAt).toBeNull();

    // Removed before the company was deleted — stays out.
    const userARowAfter = await knex('tenant_users').where({ id: userARow.id }).first();
    expect(userARowAfter.deletedAt).not.toBeNull();

    // And the auth-side membership is back, with the role mapped as on invite.
    const authOwner = apiHelper.authStore.users.get(apiHelper.ownerA.authUserId);
    expect(authOwner?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: apiHelper.tenantA.authGroupId, role: 'ADMIN' }),
      ]),
    );
  });

  it('refuses to create a second tenant for a live company', async () => {
    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/tenants/invite')
      .set(adminHeaders())
      .send(invitePayload());

    expect(res.statusCode).toBe(422);
    expect(res.body.type).toBe('ALREADY_EXISTS');
  });
});
