'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import { EntityChangedParams, RestrictionType } from '../types';
import { AuthGroupRole, TenantUser, TenantUserRole } from './tenantUsers.service';
import { User, UserType } from './users.service';

import authMixin from 'biip-auth-nodejs/mixin';
import { UserAuthMeta } from './api.service';
import { Tenant } from './tenants.service';

type UsersMap = Record<string, { id?: User['id']; authUser: number; row: any[] }>;

type TenantsMap = Record<string, { id?: Tenant['id']; authGroup: number; row: any[] }>;

@Service({
  name: 'auth',
  mixins: [
    authMixin(process.env.AUTH_API_KEY, {
      host: process.env.AUTH_HOST || '',
      appHost: process.env.URL, // after evartai successful login
    }),
  ],
  hooks: {
    after: {
      login: 'afterUserLoggedIn',
      'evartai.login': 'afterUserLoggedIn',
    },
    before: {
      'evartai.login': 'beforeUserLogin',
      login: 'beforeUserLogin',
    },
  },
  actions: {
    login: {
      auth: RestrictionType.PUBLIC,
    },
    refreshToken: {
      auth: RestrictionType.PUBLIC,
    },
    'evartai.login': {
      auth: RestrictionType.PUBLIC,
    },
    'evartai.sign': {
      auth: RestrictionType.PUBLIC,
    },
  },
})
export default class AuthService extends moleculer.Service {
  @Action({
    auth: RestrictionType.USER,
  })
  async me(ctx: Context<{}, UserAuthMeta>) {
    const user: User = await ctx.call('users.resolve', {
      id: ctx.meta.user.id,
      populate: 'tenantUsers',
    });

    const data: any = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      type: user.type,
    };

    if (user.type === UserType.USER) {
      data.profiles = await ctx.call('tenantUsers.getProfiles');
    }

    return data;
  }

  @Method
  async afterUserLoggedIn(ctx: any, data: any) {
    if (!data || !data.token) {
      return data;
    }

    const meta = { authToken: data.token };

    const authUser: any = await ctx.call('auth.users.resolveToken', null, {
      meta,
    });

    if (authUser?.type !== UserType.USER) {
      if (process.env.NODE_ENV === 'local') {
        return data;
      }

      throw new moleculer.Errors.MoleculerClientError('Invalid user type.', 401, 'INVALID_TYPE');
    }

    let user: User = await ctx.call('users.findOne', {
      query: {
        authUser: authUser.id,
      },
    });

    if (!user) {
      // Should not be a case. But sometimes it happens
      user = await ctx.call('users.create', {
        authUser: authUser.id,
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        email: authUser.email,
        phone: authUser.phone,
      });
    }

    // update tenants info from e-vartai
    const authUserGroups: any = await ctx.call(
      'auth.users.get',
      {
        id: authUser?.id,
        populate: 'groups',
      },
      { meta },
    );

    const authGroups: any[] = authUserGroups?.groups || [];

    const isFreelancer = authGroups.some(
      (authGroup: any) => authGroup.id === Number(process.env.FREELANCER_GROUP_ID),
    );

    // update user info from e-vartai
    const updatedUser = await ctx.call('users.update', {
      id: user.id,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      lastLogin: Date.now(),
      isFreelancer,
    });

    for (const authGroup of authGroups) {
      if (!authGroup.id) {
        continue;
      }

      let tenant: Tenant = await ctx.call('tenants.findOne', {
        query: {
          authGroup: authGroup.id,
        },
      });

      if (!tenant) {
        continue;
      }

      let name = tenant.name;
      if (authGroup.name && !(authGroup.name as string).startsWith('Company: ')) {
        name = authGroup.name;
      }

      const updatedTenant = await ctx.call('tenants.update', {
        id: tenant.id,
        name,
        code: authGroup.companyCode,
        email: authGroup.companyEmail,
        phone: authGroup.companyPhone,
      });

      // Update tenantUser role if changed in Auth module
      // Should only be a case when NOT OWNER becomes an OWNER (after login as "juridinis asmuo")
      // All other cases are done from our app and synced to Auth
      let tenantUser: TenantUser = await ctx.call('tenantUsers.findOne', {
        query: {
          tenant: tenant.id,
          user: user.id,
        },
      });

      if (!tenantUser) {
        // Again, should NOT be a case, but we cannot trust 3rd party
        tenantUser = await ctx.call('tenantUsers.create', {
          tenant: tenant.id,
          user: user.id,
          role: authGroup.role === AuthGroupRole.ADMIN ? TenantUserRole.OWNER : TenantUserRole.USER,
        });
      } else {
        if (authGroup.role === AuthGroupRole.ADMIN && tenantUser.role !== TenantUserRole.OWNER) {
          // After login with "juridinis asmuo" auth changes relation to ADMIN
          // So we have to change it to OWNER
          await ctx.call('tenantUsers.update', {
            id: tenantUser.id,
            role: TenantUserRole.OWNER,
          });
        }

        if (authGroup.role === AuthGroupRole.USER && tenantUser.role === TenantUserRole.OWNER) {
          // Changing from OWNER to other roles SHOULD NOT happen without our app
          // But again, just in case
          await ctx.call('tenantUsers.update', {
            id: tenantUser.id,
            role: TenantUserRole.USER,
          });
        }
      }
    }

    return data;
  }

  @Method
  async beforeUserLogin(ctx: any) {
    ctx.params = ctx.params || {};
    ctx.params.refresh = true;
    return ctx;
  }

  @Action({
    rest: 'GET /assignees',
    auth: RestrictionType.ADMIN,
  })
  async getAssignees(ctx: Context<any>) {
    return await ctx.call('auth.users.list', {
      query: { type: UserType.ADMIN },
      ...ctx.params,
      pageSize: 100,
    });
    //TODO: fix temporary solution page size
  }

  @Event()
  async 'users.updated'(ctx: Context<EntityChangedParams<User>>) {
    const user = ctx.params.data as User;
    const oldUser = ctx.params.oldData as User;

    if (oldUser.isFreelancer === user.isFreelancer) {
      return;
    }

    if (user.isFreelancer) {
      return await ctx.call('auth.users.assignToGroup', {
        id: user.authUser,
        groupId: Number(process.env.FREELANCER_GROUP_ID),
      });
    }

    return await ctx.call('auth.users.unassignFromGroup', {
      id: user.authUser,
      groupId: process.env.FREELANCER_GROUP_ID,
    });
  }

  @Event()
  async 'users.removed'(ctx: Context<EntityChangedParams<User>>) {
    const user = ctx.params.data as User;

    await ctx.call('auth.users.remove', { id: user.authUser }, { meta: ctx.meta });
  }

  @Event()
  async 'tenantUsers.removed'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const tenantUser = ctx.params.data as TenantUser;

    const entity: TenantUser<'tenant' | 'user'> = await ctx.call('tenantUsers.resolve', {
      id: tenantUser.id,
      populate: 'user,tenant',
      scope: false,
    });

    await ctx.call('auth.users.unassignFromGroup', {
      id: entity.user.authUser,
      groupId: entity.tenant.authGroup,
    });
  }

  @Event()
  async 'tenantUsers.updated'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const tenantUser = ctx.params.data as TenantUser;
    const oldTenantUser = ctx.params.oldData as TenantUser;

    const roleToAuthGroupRole = (role: TenantUserRole): AuthGroupRole =>
      role === TenantUserRole.OWNER ? AuthGroupRole.ADMIN : AuthGroupRole.USER;

    const authRole = roleToAuthGroupRole(tenantUser.role);
    const oldAuthRole = roleToAuthGroupRole(oldTenantUser.role);

    if (authRole === oldAuthRole) {
      return;
    }

    const entity: TenantUser<'tenant' | 'user'> = await ctx.call('tenantUsers.resolve', {
      id: tenantUser.id,
      populate: 'user,tenant',
      scope: false,
    });

    await ctx.call('auth.users.assignToGroup', {
      id: entity.user.authUser,
      groupId: entity.tenant.authGroup,
      role: authRole,
    });
  }
}
