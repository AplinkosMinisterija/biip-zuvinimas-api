'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  FieldHookCallback,
  RestrictionType,
} from '../types';
import { TenantUserRole } from './tenantUsers.service';

import DbConnection from '../mixins/database.mixin';
import { UserAuthMeta } from './api.service';
import { UserType } from './users.service';

export interface Tenant {
  id: string;
  name: string;
  authGroup: string;
}

@Service({
  name: 'tenants',

  mixins: [
    DbConnection({
      collection: 'tenants',
      createActions: {
        createMany: false,
      },
    }),
  ],

  settings: {
    auth: RestrictionType.ADMIN,
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      authGroup: {
        type: 'number',
        columnType: 'integer',
        columnName: 'authGroupId',
        populate: async (ctx: Context, values: number[]) => {
          return Promise.all(
            values.map((value) => {
              return ctx.call('auth.groups.get', { id: value, scope: false });
            }),
          );
        },
        async onRemove({ ctx, entity }: FieldHookCallback) {
          await ctx.call('auth.groups.remove', { id: entity.authGroupId }, { meta: ctx?.meta });
        },
        required: true,
      },
      name: 'string',
      email: 'string',
      phone: 'string',
      code: 'string|required',
      tenantUsers: {
        type: 'array',
        readonly: true,
        virtual: true,
        default: () => [],
        async populate(ctx: any, _values: any, tenants: any[]) {
          return Promise.all(
            tenants.map((tenant: any) => {
              return ctx.call('tenantUsers.find', {
                query: {
                  tenant: tenant.id,
                },
              });
            }),
          );
        },
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['owner'],
  },

  actions: {
    find: {},
    list: {
      auth: RestrictionType.DEFAULT,
    },
    count: {},
    get: {},
    create: {
      rest: null,
    },
    update: {},
    remove: {},
  },
})
export default class TenantsService extends moleculer.Service {
  @Action({
    rest: 'POST /invite',
    params: {
      companyCode: 'string',
      companyName: 'string',
      companyPhone: 'string',
      companyEmail: 'string',
      companyAddress: 'string',

      ownerRequired: {
        type: 'boolean',
        default: false,
        required: false,
      },

      firstName: 'string|optional',
      lastName: 'string|optional',
      email: 'string|optional',
      phone: 'string|optional',
      personalCode: 'string|optional',
    },
    types: UserType.ADMIN,
  })
  async invite(
    ctx: Context<
      {
        companyName: string;
        companyCode: string;
        companyPhone: string;
        companyEmail: string;
        companyAddress: string;
        ownerRequired?: boolean;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        personalCode?: string;
      },
      UserAuthMeta
    >,
  ) {
    const {
      companyName,
      companyCode,
      companyPhone,
      companyEmail,
      companyAddress,

      ownerRequired,

      firstName,
      lastName,
      email,
      phone,
      personalCode,
    } = ctx.params;

    const inviteData: any = {
      companyCode: ctx.params.companyCode,
      throwErrors: true,
    };
    if (ctx.params.companyEmail) {
      inviteData.notify = [ctx.params.companyEmail];
    }

    // it will throw error if tenant already exists
    const authGroup: any = await ctx.call('auth.users.invite', inviteData);

    const tenantData = {
      email: companyEmail,
      phone: companyPhone,
      name: companyName,
      address: companyAddress,
      code: companyCode,
    };

    // The auth server keeps company groups and hands the same one back when a
    // company is invited again, so a deleted company must reuse its own row
    // instead of leaving two tenants pointing at one auth group.
    const existingTenant: Tenant & Partial<CommonFields> = await this.findEntity(null, {
      query: { authGroup: authGroup.id },
      scope: false,
    });

    const tenant: Tenant = existingTenant
      ? await this.restoreTenant(ctx, existingTenant, tenantData)
      : await this.createEntity(ctx, { ...tenantData, authGroup: authGroup.id });

    if (ownerRequired) {
      await ctx.call('tenantUsers.invite', {
        tenant: tenant.id,
        role: TenantUserRole.OWNER,
        firstName,
        lastName,
        personalCode,
        email,
        phone,
      });
    }

    return tenant;
  }

  @Method
  async restoreTenant(
    ctx: Context<any, UserAuthMeta>,
    tenant: Tenant & Partial<CommonFields>,
    data: Record<string, any>,
  ) {
    if (!tenant.deletedAt) {
      throw new moleculer.Errors.MoleculerClientError(
        'Tenant already exists',
        422,
        'ALREADY_EXISTS',
      );
    }

    const deletedAt = new Date(tenant.deletedAt);

    await this.updateEntity(
      ctx,
      { id: tenant.id, $set: { deletedAt: null, deletedBy: null } },
      { raw: true, permissive: true, scope: false },
    );

    await ctx.call('tenantUsers.restoreRemovedWithTenant', {
      tenant: Number(tenant.id),
      deletedFrom: deletedAt.toISOString(),
    });

    return this.updateEntity(ctx, { id: tenant.id, ...data });
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['auth']);

    const data: Array<any> = await this.broker.call('auth.getSeedData', {
      timeout: 120 * 1000,
    });

    const authGroupsMap: Record<number, any> = {};
    for (const authUser of data) {
      if (authUser.groups?.length) {
        for (const group of authUser.groups) {
          if (!group.id) continue;

          authGroupsMap[group.id] = group;
        }
      }
    }

    for (const authGroupKey in authGroupsMap) {
      const authGroup = authGroupsMap[authGroupKey];
      if (authGroup.id !== Number(process.env.FREELANCER_GROUP_ID) && authGroup.companyCode) {
        await this.createEntity(null, {
          name: authGroup.name,
          email: authGroup.companyEmail,
          phone: authGroup.companyPhone,
          code: authGroup.companyCode,
          address: authGroup.address,
          authGroup: authGroup.id,
        });
      }
    }
  }

  @Action({
    visibility: 'protected',
    rest: null,
  })
  createPermissive(ctx: Context) {
    return this.createEntity(ctx, ctx.params, {
      permissive: true,
    });
  }
}
