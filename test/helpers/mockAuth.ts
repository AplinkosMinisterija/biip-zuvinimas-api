'use strict';

// Stand-in for the biip-auth-nodejs powered `auth` service. Provides the same
// action surface that zuvinimas-api consumes via ctx.call('auth.users.*', ...)
// and keeps tiny in-memory state so tests can simulate logins, invites,
// group assignments and impersonation without needing a real biip-auth-api.

import { ServiceSchema } from 'moleculer';

export type MockAuthUserType = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export interface MockAuthUser {
  id: number;
  type: MockAuthUserType;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  municipalities?: number[];
  groups: Array<{ id: number; name?: string; companyCode?: string; role?: 'ADMIN' | 'USER' }>;
}

export interface MockAuthGroup {
  id: number;
  name: string;
  companyCode?: string;
  companyEmail?: string;
  companyPhone?: string;
}

export class MockAuthStore {
  users = new Map<number, MockAuthUser>();
  groups = new Map<number, MockAuthGroup>();
  tokens = new Map<string, number>();

  private nextUserId = 100;
  private nextGroupId = 200;

  addUser(u: Partial<MockAuthUser> & { type: MockAuthUserType }): MockAuthUser {
    const id = u.id ?? this.nextUserId++;
    const user: MockAuthUser = {
      id,
      type: u.type,
      firstName: u.firstName ?? `User${id}`,
      lastName: u.lastName ?? 'Test',
      email: u.email ?? `user${id}@example.com`,
      phone: u.phone,
      municipalities: u.municipalities ?? [],
      groups: u.groups ?? [],
    };
    this.users.set(id, user);
    return user;
  }

  addGroup(g: Partial<MockAuthGroup> & { name: string }): MockAuthGroup {
    const id = g.id ?? this.nextGroupId++;
    const group: MockAuthGroup = {
      id,
      name: g.name,
      companyCode: g.companyCode,
      companyEmail: g.companyEmail,
      companyPhone: g.companyPhone,
    };
    this.groups.set(id, group);
    return group;
  }

  issueToken(userId: number): string {
    const token = `tok-${userId}-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(token, userId);
    return token;
  }
}

export function makeMockAuthService(store: MockAuthStore): ServiceSchema {
  return {
    name: 'auth',
    actions: {
      'users.resolveToken': {
        handler(ctx: any) {
          const token = ctx.meta?.authToken;
          if (!token) throw new Error('NO_TOKEN');
          const userId = store.tokens.get(token);
          if (!userId) throw new Error('INVALID_TOKEN');
          return store.users.get(userId);
        },
      },

      'users.get': {
        handler(ctx: any) {
          const user = store.users.get(Number(ctx.params.id));
          if (!user && ctx.params.throwIfNotExist) throw new Error('NOT_FOUND');
          if (ctx.params.populate === 'groups' && user) {
            return { ...user, groups: user.groups };
          }
          return user;
        },
      },

      'users.list': {
        handler(ctx: any) {
          const query = ctx.params?.query ?? {};
          const all = Array.from(store.users.values()).filter((u) => {
            if (query.type && u.type !== query.type) return false;
            return true;
          });
          return {
            rows: all,
            total: all.length,
            page: 1,
            pageSize: all.length,
            totalPages: 1,
          };
        },
      },

      'users.invite': {
        handler(ctx: any) {
          // mimic biip-auth-api: invite by personalCode or companyCode
          const existing = Array.from(store.users.values()).find(
            (u) => (u as any).personalCode && (u as any).personalCode === ctx.params.personalCode,
          );
          if (existing && ctx.params.throwErrors) throw new Error('USER_EXISTS');
          if (ctx.params.companyCode) {
            // company invite — biip-auth-api looks the group up by company code and
            // hands back the SAME group when the company is invited again (see
            // usersEvartai.service.ts `invite`), so a re-invite must not mint a new id.
            const existingGroup = Array.from(store.groups.values()).find(
              (g) => g.companyCode && g.companyCode === ctx.params.companyCode,
            );
            if (existingGroup) return existingGroup;

            return store.addGroup({
              name: `Company: ${ctx.params.companyCode}`,
              companyCode: ctx.params.companyCode,
            });
          }
          const u = store.addUser({
            type: 'USER',
            firstName: ctx.params.firstName ?? 'Invited',
            lastName: ctx.params.lastName ?? 'User',
            email: (ctx.params.notify && ctx.params.notify[0]) || `pc-${ctx.params.personalCode}@example.com`,
          });
          return u;
        },
      },

      'users.assignToGroup': {
        handler(ctx: any) {
          const user = store.users.get(Number(ctx.params.id));
          if (!user) return null;
          const groupId = Number(ctx.params.groupId);
          const existing = user.groups.find((g) => g.id === groupId);
          // biip-auth-api `userGroups.assign` upserts: an existing membership keeps
          // its row and has its role updated.
          if (existing) {
            existing.role = ctx.params.role ?? existing.role;
          } else {
            user.groups.push({ id: groupId, role: ctx.params.role ?? 'USER' });
          }
          return user;
        },
      },

      'users.unassignFromGroup': {
        handler(ctx: any) {
          const user = store.users.get(Number(ctx.params.id));
          if (!user) return null;
          user.groups = user.groups.filter((g) => g.id !== Number(ctx.params.groupId));
          return user;
        },
      },

      'users.impersonate': {
        handler(ctx: any) {
          const target = store.users.get(Number(ctx.params.id));
          if (!target) throw new Error('NOT_FOUND');
          return { token: store.issueToken(target.id), user: target };
        },
      },

      'users.remove': {
        handler(ctx: any) {
          store.users.delete(Number(ctx.params.id));
          return true;
        },
      },

      'groups.get': {
        handler(ctx: any) {
          return store.groups.get(Number(ctx.params.id));
        },
      },

      'groups.remove': {
        handler(ctx: any) {
          // biip-auth-api keeps company groups: `DELETE /api/groups/:id` only drops the
          // calling app from the group's app list when it has a companyCode
          // (groups.service.ts `removeGroup`), so the group id survives and a later
          // invite by the same company code returns it again.
          const group = store.groups.get(Number(ctx.params.id));
          if (group?.companyCode) return { success: true };

          store.groups.delete(Number(ctx.params.id));
          return { success: true };
        },
      },

      'permissions.getUsersByAccess': {
        handler() {
          return { rows: [] };
        },
      },

      'public.getUsersInGroup': {
        handler() {
          return { rows: [] };
        },
      },

      getSeedData: {
        handler() {
          return [];
        },
      },

      login: { handler: () => ({ token: '', refreshToken: '' }) },
      'evartai.login': { handler: () => ({ token: '', refreshToken: '' }) },
      'evartai.sign': { handler: () => ({ url: '' }) },
      refreshToken: { handler: () => ({ token: '' }) },
    },
  };
}
