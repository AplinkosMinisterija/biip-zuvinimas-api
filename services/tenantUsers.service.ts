'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
  throwNoRightsError,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { User, UserType } from './users.service';

import DbConnection from '../mixins/database.mixin';
import {
  roleToAuthGroupRole,
  sanitizeQueryForTenantScope,
  validateCanManageTenantUser,
} from '../utils/functions';
import { Tenant } from './tenants.service';

export enum AuthGroupRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum TenantUserRole {
  USER = 'USER',
  USER_ADMIN = 'USER_ADMIN',
  OWNER = 'OWNER',
}

export const FREELANCER_PROFILE_ID = 'freelancer';

interface Fields extends CommonFields {
  id: string;
  tenant: Tenant['id'];
  user: User['id'];
  role: TenantUserRole;
}

interface Populates extends CommonPopulates {
  user: User;
  tenant: Tenant;
}

export type TenantUser<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'tenantUsers',

  mixins: [
    DbConnection({
      collection: 'tenantUsers',
      entityChangedOldEntity: true,
      createActions: {
        createMany: false,
      },
    }),
  ],

  settings: {
    auth: RestrictionType.ADMIN,

    plantuml: {
      relations: {
        tenants: 'zero-or-many-to-one',
        users: 'zero-or-many-to-one',
      },
    },

    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        required: true,
        immutable: true,
        populate: {
          action: 'tenants.resolve',
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        required: true,
        immutable: true,
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
        // validate: "validateTenant",
      },
      role: {
        type: 'string',
        enum: Object.values(TenantUserRole),
        default: TenantUserRole.USER,
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulate: ['user'],
  },

  // TODO: list action - hooksu apriboti tik useriui priklausancius
  hooks: {
    before: {
      create: ['beforeCreate', 'canManageTenantUsers'],
      update: ['canManageTenantUsers', 'validateTargetTenant'],
      remove: ['canManageTenantUsers', 'validateTargetTenant'],
      list: ['beforeSelect'],
      count: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },

  actions: {
    // `find` has no `beforeSelect` hook, so over HTTP it returned the whole
    // table to any logged-in user. Nothing outside the API calls it — the web
    // apps use `list` — and internal `ctx.call('tenantUsers.find', ...)`
    // (populates in users/tenants, canProfileModifyFishStocking) still works.
    find: { visibility: 'protected' },
    list: {
      auth: RestrictionType.DEFAULT,
    },
    count: { auth: RestrictionType.DEFAULT },
    // `get` resolves by primary key and ignores the `beforeSelect` query scope,
    // so a USER could read any tenant's membership row by id. Only the admin UI
    // opens a single tenantUser.
    get: { auth: RestrictionType.ADMIN },
    create: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      auth: RestrictionType.DEFAULT,
    },
    remove: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class TenantUsersService extends moleculer.Service {
  @Action({
    auth: RestrictionType.USER,
  })
  my(ctx: Context<null, UserAuthMeta>) {
    return this.findEntities(ctx, {
      query: {
        user: ctx.meta.user.id,
      },
    });
  }

  @Action({
    rest: 'POST /invite',
    auth: RestrictionType.DEFAULT,
    params: {
      firstName: 'string',
      lastName: 'string',
      personalCode: 'string',
      phone: {
        type: 'string',
        optional: true,
      },
      role: {
        type: 'enum',
        values: Object.values(TenantUserRole),
      },
      tenant: 'number',
      email: {
        type: 'string',
        optional: true,
      },
    },
  })
  async invite(
    ctx: Context<
      {
        tenant: number;
        role: TenantUserRole;
        firstName: string;
        lastName: string;
        personalCode: string;
        email: string;
        phone: string;
      },
      UserAuthMeta
    >,
  ) {
    const { firstName, lastName, personalCode, role, email, phone, tenant: tenantId } = ctx.params;
    // OWNER and USER_ADMIN can invite users

    validateCanManageTenantUser(ctx, 'Only OWNER and USER_ADMIN can add users to tenant.');

    // validateCanManageTenantUser only checks the caller's role in their CURRENT
    // X-Profile tenant. Without an additional check here, an OWNER/USER_ADMIN of
    // tenant A could invite themselves (or anyone) as OWNER of tenant B by
    // simply passing tenant=B in the body — auth.users.invite is server-to-server
    // and trusts our companyId, so it would happily add the auth-group ADMIN
    // binding. Verify the target tenant matches the caller's active profile.
    // Admins (ADMIN / SUPER_ADMIN) are allowed to invite across any tenant.
    const isAdmin =
      ctx.meta?.authUser?.type === AuthUserRole.ADMIN ||
      ctx.meta?.authUser?.type === AuthUserRole.SUPER_ADMIN;
    if (!isAdmin) {
      const profile = Number(ctx.meta?.profile);
      if (!Number.isFinite(profile) || Number(tenantId) !== profile) {
        throwNoRightsError('Cannot invite users into another tenant');
      }
    }

    const tenant: Tenant = await ctx.call('tenants.resolve', { id: tenantId });

    const authRole = roleToAuthGroupRole(role);

    const inviteData: any = {
      personalCode,
      companyId: tenant.authGroup,
      role: authRole,
    };

    if (email) {
      inviteData.notify = [email];
    }

    // if user aleady in group - it will throw error
    const authUser: any = await ctx.call('auth.users.invite', inviteData);

    let user: User = await ctx.call('users.findOne', {
      query: {
        authUser: authUser.id,
      },
    });

    if (!user) {
      user = await ctx.call('users.create', {
        authUser: authUser.id,
        firstName,
        lastName,
        email,
        phone,
      });
    }

    return this.createEntity(ctx, {
      tenant: tenant.id,
      user: user.id,
      role,
    });
  }

  @Action({})
  async getProfiles(ctx: Context<{}, UserAuthMeta>) {
    const { user } = ctx.meta;
    if (!user?.id || user?.type === UserType.ADMIN) return [];
    const tenantUsers: TenantUser[] = await this.findEntities(null, {
      query: {
        user: user.id,
      },
      scopes: false,
      populate: 'tenant',
    });

    const profiles: any[] = tenantUsers?.map((tenantUser: any) => {
      return {
        id: tenantUser.tenant.id,
        name: tenantUser.tenant.name,
        freelancer: false,
        email: user.email,
        phone: user.phone,
        role: tenantUser.role,
        code: tenantUser.tenant.code,
      };
    });
    if (user.isFreelancer) {
      profiles.push({
        id: FREELANCER_PROFILE_ID,
        name: `${user.firstName} ${user.lastName}`,
        freelancer: true,
        email: user.email,
        phone: user.phone,
      });
    }

    return profiles;
  }

  // Called by `tenants.invite` when a deleted company is invited again: the members
  // that the tenant-removal cascade took out come back, while anyone removed before
  // that (i.e. removed deliberately) stays out.
  @Action({
    visibility: 'protected',
    params: {
      tenant: 'number|convert',
      deletedFrom: 'string',
    },
  })
  async restoreRemovedWithTenant(ctx: Context<{ tenant: number; deletedFrom: string }>) {
    const { tenant, deletedFrom } = ctx.params;
    // The cascade runs a few ms after the tenant row is stamped; allow for that
    // without reaching back to removals that happened before the deletion.
    const since = new Date(deletedFrom).getTime() - 1000;

    const tenantUsers: TenantUser<'user'>[] = await this.findEntities(null, {
      query: { tenant },
      populate: 'user',
      scope: false,
    });

    const removedWithTenant = tenantUsers.filter(
      (tenantUser) => tenantUser.deletedAt && new Date(tenantUser.deletedAt).getTime() >= since,
    );

    if (!removedWithTenant.length) {
      return [];
    }

    const tenantEntity: Tenant = await ctx.call('tenants.resolve', { id: tenant });

    for (const tenantUser of removedWithTenant) {
      await this.updateEntity(
        ctx,
        { id: tenantUser.id, $set: { deletedAt: null, deletedBy: null } },
        { raw: true, permissive: true, scope: false },
      );

      await ctx.call('auth.users.assignToGroup', {
        id: tenantUser.user.authUser,
        groupId: Number(tenantEntity.authGroup),
        role: roleToAuthGroupRole(tenantUser.role),
      });
    }

    return removedWithTenant.map((tenantUser) => tenantUser.id);
  }

  @Method
  async beforeCreate(ctx: Context<any>) {
    const { user, tenant } = ctx.params;

    const tenantUsersCount = await ctx.call('tenantUsers.count', {
      query: {
        tenant,
        user,
      },
    });

    if (tenantUsersCount) {
      throw new moleculer.Errors.MoleculerClientError('Already exists', 422, 'ALREADY_EXISTS');
    }

    const userEntity: User = await ctx.call('users.get', { id: user });
    const tenantEntity: Tenant = await ctx.call('tenants.get', { id: tenant });

    await ctx.call('auth.users.assignToGroup', {
      id: userEntity.authUser,
      groupId: tenantEntity.authGroup,
    });
  }

  @Method
  async beforeSelect(ctx: Context<any, UserAuthMeta>) {
    // Internal service-to-service calls (e.g. tenantUsers.beforeCreate calling
    // tenantUsers.count for duplicate detection) carry no auth metadata. Skip
    // permission enforcement for those — HTTP requests always populate authUser
    // via api.service.ts authenticate() before any action runs.
    if (!ctx.meta?.authUser) {
      return;
    }

    validateCanManageTenantUser(ctx, 'Only OWNER and USER_ADMIN can select users from tenant.');

    if (ctx.meta.authUser.type === AuthUserRole.USER) {
      // `tenant` is spread LAST: a caller-supplied `query.tenant` used to replace it
      // and list another tenant's members.
      ctx.params.query = {
        ...sanitizeQueryForTenantScope(ctx.params.query),
        tenant: ctx.meta.profile,
      };
    }
  }

  @Method
  async canManageTenantUsers(ctx: Context<any, UserAuthMeta>) {
    validateCanManageTenantUser(ctx, 'Only OWNER and USER_ADMIN can manage tenant users.');
  }

  @Method
  async validateTargetTenant(ctx: Context<any, UserAuthMeta>) {
    // Admins (incl. SUPER_ADMIN) can manage any tenantUser across tenants.
    if (
      ctx.meta?.authUser?.type === AuthUserRole.ADMIN ||
      ctx.meta?.authUser?.type === AuthUserRole.SUPER_ADMIN
    ) {
      return;
    }

    const id = ctx.params?.id;
    if (id == null) {
      throwNoRightsError('Missing id');
    }

    const target: TenantUser = await this.resolveEntities(ctx, { id, scope: false });
    if (!target) {
      throw new moleculer.Errors.MoleculerClientError('Not found', 404, 'NOT_FOUND');
    }

    const profile = Number(ctx.meta?.profile);
    // tenant column is integer in DB but typed as string through Tenant['id'].
    if (!Number.isFinite(profile) || Number(target.tenant) !== profile) {
      throwNoRightsError('Cannot manage tenantUser from another tenant');
    }
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['auth', 'tenants', 'users']);

    const data: Array<any> = await this.broker.call('auth.getSeedData', {
      timeout: 120 * 1000,
    });

    for (const authUser of data) {
      const user: User = await this.broker.call('users.findOne', {
        query: {
          authUser: authUser.id,
        },
      });

      if (authUser.groups?.length) {
        for (const group of authUser.groups) {
          if (group.id && group.id !== Number(process.env.FREELANCER_GROUP_ID)) {
            const tenant: Tenant = await this.broker.call('tenants.findOne', {
              query: {
                authGroup: group.id,
              },
            });

            if (!tenant) {
              continue;
            }

            let role = TenantUserRole.USER;
            if (group.role === AuthGroupRole.ADMIN) {
              role = TenantUserRole.OWNER;
            }

            await this.createEntity(null, {
              user: user.id,
              tenant: tenant.id,
              role,
            });
          }
        }
      }
    }
  }

  @Event()
  async 'users.removed'(ctx: Context<{ data: User }>) {
    const user = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        user: user.id,
      },
    });
  }

  @Event()
  async 'tenants.removed'(ctx: Context<{ data: Tenant }>) {
    const tenant = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        tenant: tenant.id,
      },
    });
  }
}
