'use strict';

// The post-login role sync runs without ctx.meta.profile, so it cannot go
// through tenantUsers.update (validateTargetTenant rejects it and the whole
// e-vartai login fails). It uses the protected tenantUsers.syncRoleFromAuth.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TenantUser, TenantUserRole } from '../../../../services/tenantUsers.service';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

const findUserATenantUser = (): Promise<TenantUser> =>
  apiHelper.broker.call('tenantUsers.findOne', {
    query: { tenant: apiHelper.tenantA.tenantId, user: apiHelper.userA.appUserId },
  });

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();
});
afterAll(async () => {
  await apiHelper.stop();
});

describe('Login-time tenantUser role sync', () => {
  it('tenantUsers.update without a profile is rejected (why login cannot use it)', async () => {
    const tenantUser = await findUserATenantUser();

    await expect(
      apiHelper.broker.call('tenantUsers.update', {
        id: tenantUser.id,
        role: TenantUserRole.OWNER,
      }),
    ).rejects.toMatchObject({ type: 'NO_RIGHTS' });
  });

  it('syncRoleFromAuth updates the role without a profile', async () => {
    const tenantUser = await findUserATenantUser();

    await apiHelper.broker.call('tenantUsers.syncRoleFromAuth', {
      id: tenantUser.id,
      role: TenantUserRole.OWNER,
    });

    const updated = await findUserATenantUser();
    expect(updated.role).toBe(TenantUserRole.OWNER);
  });

  it('syncRoleFromAuth rejects an unknown role', async () => {
    const tenantUser = await findUserATenantUser();

    await expect(
      apiHelper.broker.call('tenantUsers.syncRoleFromAuth', {
        id: tenantUser.id,
        role: 'SUPER_OWNER',
      }),
    ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
  });

  it('syncRoleFromAuth is not reachable over HTTP', async () => {
    const tenantUser = await findUserATenantUser();

    const res = await request(apiService.server)
      .post('/zuvinimasnew/api/tenantUsers/syncRoleFromAuth')
      .set(
        apiHelper.headers({
          token: apiHelper.ownerA.token,
          profile: apiHelper.tenantA.tenantId,
        }),
      )
      .send({ id: tenantUser.id, role: TenantUserRole.OWNER });

    expect([404, 503]).toContain(res.status);
  });
});
