'use strict';

import { describe, expect, it } from '@jest/globals';
import { AuthGroupRole, TenantUserRole } from '../../services/tenantUsers.service';
import { getTenantUserRoleFromAuth } from '../../utils/functions';

describe('getTenantUserRoleFromAuth', () => {
  it('promotes USER to OWNER when auth relation is ADMIN (login as "juridinis asmuo")', () => {
    expect(getTenantUserRoleFromAuth(AuthGroupRole.ADMIN, TenantUserRole.USER)).toBe(
      TenantUserRole.OWNER,
    );
  });

  it('keeps USER_ADMIN when auth relation is ADMIN', () => {
    expect(getTenantUserRoleFromAuth(AuthGroupRole.ADMIN, TenantUserRole.USER_ADMIN)).toBe(
      TenantUserRole.USER_ADMIN,
    );
  });

  it('keeps OWNER when auth relation is USER (OWNER added by an admin)', () => {
    expect(getTenantUserRoleFromAuth(AuthGroupRole.USER, TenantUserRole.OWNER)).toBe(
      TenantUserRole.OWNER,
    );
  });

  it.each([
    [AuthGroupRole.ADMIN, TenantUserRole.OWNER],
    [AuthGroupRole.USER, TenantUserRole.USER],
    [AuthGroupRole.USER, TenantUserRole.USER_ADMIN],
  ])('leaves %s / %s unchanged', (authRole, role) => {
    expect(getTenantUserRoleFromAuth(authRole, role)).toBe(role);
  });
});
