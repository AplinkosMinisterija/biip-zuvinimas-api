'use strict';

import { BrokerOptions, ServiceBroker } from 'moleculer';
import config from '../../moleculer.config';
import { makeMockAuthService, MockAuthStore, MockAuthUser } from './mockAuth';

const ApiSchema = require('../../services/api.service').default;
const UsersSchema = require('../../services/users.service').default;
const TenantsSchema = require('../../services/tenants.service').default;
const TenantUsersSchema = require('../../services/tenantUsers.service').default;
const FishStockingsSchema = require('../../services/fishStockings.service').default;
const FishBatchesSchema = require('../../services/fishBatches.service').default;
const FishStockingPhotosSchema = require('../../services/fishStockingPhotos.service').default;
const FishTypesSchema = require('../../services/fishTypes.service').default;
const FishAgesSchema = require('../../services/fishAges.service').default;
const SettingsSchema = require('../../services/settings.service').default;
const PublicSchema = require('../../services/public.service').default;
const MandatoryLocationsSchema = require('../../services/mandatoryLocations.service').default;
const RecentLocationsSchema = require('../../services/recentLocations.service').default;
const LocationsSchema = require('../../services/locations.service').default;
const PublishingFishStockingsSchema = require('../../services/publishing.fishStockings.service').default;
const FishStockingsCompletedSchema = require('../../services/fishStockingsCompleted.service').default;

// Services we replace with stubs so tests don't touch the network or
// external infrastructure (MinIO, Postmark, Sentry).
// Mirror visibility:'protected' from the real services/minio.service.ts so
// these stub actions are NOT reachable via HTTP gateway (mappingPolicy:'all').
// The handlers themselves are no-ops since tests never hit the actual MinIO
// instance.
const protectedNoop = (returnValue: any = true) => ({
  visibility: 'protected' as const,
  handler: () => returnValue,
});
const MinioStubSchema = {
  name: 'minio',
  actions: {
    putObject: protectedNoop(),
    fPutObject: protectedNoop(),
    getObject: protectedNoop(Buffer.from('')),
    fGetObject: protectedNoop(),
    removeObject: protectedNoop(),
    removeBucket: protectedNoop(),
    bucketExists: protectedNoop(),
    makeBucket: protectedNoop(),
    listObjects: protectedNoop([] as any[]),
    presignedGetObject: protectedNoop('http://test-minio/object'),
    presignedPutObject: protectedNoop('http://test-minio/upload'),
    publicUrl: protectedNoop('http://test-minio/public'),
  },
};

const MailStubSchema = {
  name: 'mail',
  actions: {
    sendFishStockingUpdateEmail: () => ({ sent: true }),
    sendFishStockingAssignedEmail: () => ({ sent: true }),
  },
};

const SentryStubSchema = {
  name: 'sentry',
  actions: {},
};


// Tenant codes/IDs used across specs. Keep stable so DB rows can be referenced.
export const TEST_TENANT_A_CODE = '111111111';
export const TEST_TENANT_B_CODE = '222222222';

export interface SeededUser {
  authUserId: number;
  appUserId: number; // local users.id (encoded string when returned via API)
  token: string;
}

export interface SeededTenant {
  authGroupId: number;
  tenantId: number;
}

export const errors = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  NO_RIGHTS: 'NO_RIGHTS',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
};

export class ApiHelper {
  broker: ServiceBroker;
  authStore = new MockAuthStore();

  apiService: any;

  // Fixtures populated by setup().
  superAdmin!: SeededUser & { municipalities: number[] };
  admin!: SeededUser & { municipalities: number[] };
  freelancer!: SeededUser;
  tenantA!: SeededTenant;
  tenantB!: SeededTenant;
  ownerA!: SeededUser; // OWNER of tenantA
  ownerB!: SeededUser; // OWNER of tenantB
  userA!: SeededUser; // plain USER in tenantA
  outsider!: SeededUser; // logged-in USER with no tenants & no freelancer flag

  fishTypeId!: number;
  fishAgeId!: number;

  static brokerConfig(): BrokerOptions {
    return {
      ...config,
      logLevel: (process.env.TEST_LOG_LEVEL as any) || 'warn',
      // Disable Redis cacher in tests — keeps suite hermetic.
      cacher: undefined as any,
      transporter: null,
    };
  }

  constructor() {
    this.broker = new ServiceBroker(ApiHelper.brokerConfig());
  }

  /** Boot all schemas + mock auth into the broker. Returns the api service. */
  bootServices() {
    this.broker.createService(makeMockAuthService(this.authStore));
    this.broker.createService(MinioStubSchema as any);
    this.broker.createService(MailStubSchema as any);
    this.broker.createService(SentryStubSchema as any);

    [
      UsersSchema,
      TenantsSchema,
      TenantUsersSchema,
      FishStockingsSchema,
      FishBatchesSchema,
      FishStockingPhotosSchema,
      FishTypesSchema,
      FishAgesSchema,
      SettingsSchema,
      PublicSchema,
      MandatoryLocationsSchema,
      RecentLocationsSchema,
      LocationsSchema,
      PublishingFishStockingsSchema,
      FishStockingsCompletedSchema,
    ].forEach((s) => this.broker.createService(s));

    this.apiService = this.broker.createService(ApiSchema);
    return this.apiService;
  }

  /**
   * Insert a placeholder row into mandatory_locations BEFORE broker.start()
   * so the service's `seedDB` hook (which fetches from INTERNAL_API) doesn't
   * run on first boot. Same trick for fish_types/fish_ages/settings whose
   * seedDB are harmless but slow to no-op.
   */
  private async preSeedToSuppressSeedDB() {
    const knex = require('knex')({
      client: 'pg',
      connection: process.env.DB_CONNECTION,
    });
    try {
      const tables = ['mandatory_locations', 'fish_types', 'fish_ages', 'settings', 'tenants', 'users'];
      for (const t of tables) {
        const n = await knex(t).count('* as c').first();
        if (Number(n?.c) === 0) {
          if (t === 'mandatory_locations') {
            await knex(t).insert({
              location: JSON.stringify({ cadastral_id: '__test_placeholder', name: 'Placeholder' }),
              created_at: new Date(),
            });
          } else if (t === 'fish_types') {
            await knex(t).insert({ label: '__placeholder', created_at: new Date() });
          } else if (t === 'fish_ages') {
            await knex(t).insert({ label: '__placeholder', created_at: new Date() });
          } else if (t === 'settings') {
            await knex(t).insert({
              min_time_till_fish_stocking: 1,
              max_time_for_registration: 10,
              created_at: new Date(),
            });
          }
        }
      }
    } finally {
      await knex.destroy();
    }
  }

  async start() {
    await this.preSeedToSuppressSeedDB();
    await this.broker.start();
    // Wait for all services to be available before seeding so calls go through.
    await this.broker.waitForServices([
      'api',
      'auth',
      'users',
      'tenants',
      'tenantUsers',
      'fishStockings',
      'fishBatches',
      'fishStockingPhotos',
      'fishTypes',
      'fishAges',
      'settings',
      'public',
      'mandatoryLocations',
      'recentLocations',
      'locations',
      'minio',
      'mail',
    ]);
    // moleculer-web's `autoAliases` re-scans services on the debounced
    // `$services.changed` event, which fires AFTER broker.start() returns.
    // Force an immediate rebuild so test requests don't 404 against
    // not-yet-aliased routes.
    if (typeof this.apiService.rebuildAllRoutes === 'function') {
      await this.apiService.rebuildAllRoutes();
    } else {
      // Fallback: wait 500ms for the debounced re-scan.
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async stop() {
    await this.broker.stop();
  }

  /** Delete every row in every table so each spec starts from a clean DB. */
  async resetDb() {
    const tables = [
      'fish_batches',
      'fish_stocking_photos',
      'fish_stockings',
      'recent_locations',
      'mandatory_locations',
      'tenant_users',
      'tenants',
      'users',
      'fish_types',
      'fish_ages',
      'settings',
    ];
    // Reach the knex client through the users service instance, since
    // `getAdapter` is a method on the moleculer-db mixin (not an action).
    const usersService: any = this.broker.getLocalService('users');
    const adapter: any = await usersService.getAdapter();
    const knex = adapter.client;
    for (const t of tables) {
      try {
        await knex(t).delete();
      } catch (_e) {
        // table may not exist yet on first run
      }
    }
  }

  /** Seed canonical fixtures used across most specs. */
  async setup() {
    // Reset before each setup so afterAll/beforeAll cycles are idempotent.
    await this.resetDb();

    // --- auth fixtures (mock) -------------------------------------------------
    const authSuperAdmin = this.authStore.addUser({
      type: 'SUPER_ADMIN',
      firstName: 'Super',
      lastName: 'Admin',
      email: 'super.admin@am.lt',
      municipalities: [1, 2, 3],
    });
    const authAdmin = this.authStore.addUser({
      type: 'ADMIN',
      firstName: 'Admin',
      lastName: 'AAD',
      email: 'admin@am.lt',
      municipalities: [1, 2],
    });
    const authOwnerA = this.authStore.addUser({
      type: 'USER',
      firstName: 'Owner',
      lastName: 'A',
      email: 'owner.a@example.com',
      phone: '+37060000001',
    });
    const authOwnerB = this.authStore.addUser({
      type: 'USER',
      firstName: 'Owner',
      lastName: 'B',
      email: 'owner.b@example.com',
      phone: '+37060000002',
    });
    const authUserA = this.authStore.addUser({
      type: 'USER',
      firstName: 'Regular',
      lastName: 'A',
      email: 'user.a@example.com',
      phone: '+37060000003',
    });
    const authFreelancer = this.authStore.addUser({
      type: 'USER',
      firstName: 'Free',
      lastName: 'Lancer',
      email: 'free@example.com',
      phone: '+37060000004',
    });
    const authOutsider = this.authStore.addUser({
      type: 'USER',
      firstName: 'Out',
      lastName: 'Sider',
      email: 'out@example.com',
    });

    const groupA = this.authStore.addGroup({
      name: 'Company A',
      companyCode: TEST_TENANT_A_CODE,
      companyEmail: 'companya@example.com',
      companyPhone: '+37060099991',
    });
    const groupB = this.authStore.addGroup({
      name: 'Company B',
      companyCode: TEST_TENANT_B_CODE,
      companyEmail: 'companyb@example.com',
      companyPhone: '+37060099992',
    });

    // --- local DB fixtures ----------------------------------------------------
    const seed = async (auth: any, extra: any = {}) => {
      const u: any = await this.broker.call('users.create', {
        authUser: auth.id,
        firstName: auth.firstName,
        lastName: auth.lastName,
        email: auth.email,
        phone: auth.phone,
        type: auth.type === 'USER' ? 'USER' : 'ADMIN',
        ...extra,
      });
      return u;
    };

    const tenantARow: any = await this.broker.call('tenants.create', {
      authGroup: groupA.id,
      name: 'Company A',
      code: TEST_TENANT_A_CODE,
      email: 'companya@example.com',
      phone: '+37060099991',
    });
    const tenantBRow: any = await this.broker.call('tenants.create', {
      authGroup: groupB.id,
      name: 'Company B',
      code: TEST_TENANT_B_CODE,
      email: 'companyb@example.com',
      phone: '+37060099992',
    });

    const superAdminRow = await seed(authSuperAdmin);
    const adminRow = await seed(authAdmin);
    const ownerARow = await seed(authOwnerA);
    const ownerBRow = await seed(authOwnerB);
    const userARow = await seed(authUserA);
    const freelancerRow = await seed(authFreelancer, { isFreelancer: true });
    const outsiderRow = await seed(authOutsider);

    // tenantUsers — OWNER in respective tenants
    await this.broker.call('tenantUsers.create', {
      tenant: tenantARow.id,
      user: ownerARow.id,
      role: 'OWNER',
    });
    await this.broker.call('tenantUsers.create', {
      tenant: tenantBRow.id,
      user: ownerBRow.id,
      role: 'OWNER',
    });
    await this.broker.call('tenantUsers.create', {
      tenant: tenantARow.id,
      user: userARow.id,
      role: 'USER',
    });

    // fishTypes / fishAges seed at least one of each (services seed automatically
    // via seedDB on first boot — but resetDb wiped them, so reseed).
    const ft: any = await this.broker.call('fishTypes.create', { label: 'karpiai' });
    const fa: any = await this.broker.call('fishAges.create', { label: 'Lervutės' });
    this.fishTypeId = Number(ft.id);
    this.fishAgeId = Number(fa.id);

    // settings — required by fishStockings.beforeSelect when status filter used.
    // The service disables `create` action via createActions, so insert directly.
    const usersService: any = this.broker.getLocalService('users');
    const adapter: any = await usersService.getAdapter();
    const knex = adapter.client;
    const existing = await knex('settings').select('id').limit(1);
    if (!existing.length) {
      await knex('settings').insert({
        min_time_till_fish_stocking: 1,
        max_time_for_registration: 10,
        created_at: new Date(),
      });
    }

    // --- tokens ---------------------------------------------------------------
    this.superAdmin = {
      authUserId: authSuperAdmin.id,
      appUserId: Number(superAdminRow.id),
      token: this.authStore.issueToken(authSuperAdmin.id),
      municipalities: authSuperAdmin.municipalities!,
    };
    this.admin = {
      authUserId: authAdmin.id,
      appUserId: Number(adminRow.id),
      token: this.authStore.issueToken(authAdmin.id),
      municipalities: authAdmin.municipalities!,
    };
    this.tenantA = { authGroupId: groupA.id, tenantId: Number(tenantARow.id) };
    this.tenantB = { authGroupId: groupB.id, tenantId: Number(tenantBRow.id) };
    this.ownerA = {
      authUserId: authOwnerA.id,
      appUserId: Number(ownerARow.id),
      token: this.authStore.issueToken(authOwnerA.id),
    };
    this.ownerB = {
      authUserId: authOwnerB.id,
      appUserId: Number(ownerBRow.id),
      token: this.authStore.issueToken(authOwnerB.id),
    };
    this.userA = {
      authUserId: authUserA.id,
      appUserId: Number(userARow.id),
      token: this.authStore.issueToken(authUserA.id),
    };
    this.freelancer = {
      authUserId: authFreelancer.id,
      appUserId: Number(freelancerRow.id),
      token: this.authStore.issueToken(authFreelancer.id),
    };
    this.outsider = {
      authUserId: authOutsider.id,
      appUserId: Number(outsiderRow.id),
      token: this.authStore.issueToken(authOutsider.id),
    };
  }

  /** Build headers for supertest. `profile` = tenant id, or 'freelancer'. */
  headers(opts: { token?: string; profile?: number | string } = {}) {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.token) h['Authorization'] = `Bearer ${opts.token}`;
    if (opts.profile !== undefined) h['X-Profile'] = String(opts.profile);
    return h;
  }
}
