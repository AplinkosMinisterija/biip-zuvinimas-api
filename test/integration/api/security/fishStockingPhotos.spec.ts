'use strict';
// Regression test for HIGH #6 — fishStockingPhotos BOLA.
// Before fix: any USER could DELETE /api/fishStockingPhotos/<id> of another
// tenant's photo. After fix: assertCanManageFishStocking enforces ownership.

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

// Helper: insert a fishStocking owned by tenant A, plus a photo linked to it.
// We bypass the register flow for the seed (which is heavily validated) by
// inserting directly with knex.
async function seedTenantAPhoto(): Promise<{ photoId: number; fsId: number }> {
  const adapter: any = await apiHelper.broker.getLocalService('users').getAdapter();
  const knex = adapter.client;
  const [fs] = await knex('fish_stockings')
    .insert({
      tenant_id: apiHelper.tenantA.tenantId,
      event_time: new Date(Date.now() + 86400000),
      location: JSON.stringify({
        cadastral_id: '12345',
        name: 'Test pond',
        municipality: { id: 1, name: 'Test' },
      }),
      fish_origin: 'GROWN',
      fish_origin_company_name: 'TestCo',
      assigned_to_id: apiHelper.ownerA.appUserId,
      created_by: apiHelper.ownerA.appUserId,
      created_at: new Date(),
    })
    .returning('id');

  const [photo] = await knex('fish_stocking_photos')
    .insert({
      fish_stocking_id: fs.id,
      name: 'seed.jpg',
      created_by: apiHelper.ownerA.appUserId,
      created_at: new Date(),
    })
    .returning('id');

  return { photoId: photo.id, fsId: fs.id };
}

describe('fishStockingPhotos ownership (HIGH #6)', () => {
  it('OWNER A can delete their own photo', async () => {
    const { photoId } = await seedTenantAPhoto();
    await request(apiService.server)
      .delete(`/zuvinimasnew/api/fishStockingPhotos/${photoId}`)
      .set(
        apiHelper.headers({
          token: apiHelper.ownerA.token,
          profile: apiHelper.tenantA.tenantId,
        }),
      )
      .expect(200);
  });

  it('OWNER B cannot delete tenant A photo', async () => {
    const { photoId } = await seedTenantAPhoto();
    const res = await request(apiService.server)
      .delete(`/zuvinimasnew/api/fishStockingPhotos/${photoId}`)
      .set(
        apiHelper.headers({
          token: apiHelper.ownerB.token,
          profile: apiHelper.tenantB.tenantId,
        }),
      );
    expect(res.status).toBe(401);
  });

  it('freelancer cannot delete tenant A photo', async () => {
    const { photoId } = await seedTenantAPhoto();
    const res = await request(apiService.server)
      .delete(`/zuvinimasnew/api/fishStockingPhotos/${photoId}`)
      .set(apiHelper.headers({ token: apiHelper.freelancer.token }));
    expect(res.status).toBe(401);
  });

  it('admin can delete any photo', async () => {
    const { photoId } = await seedTenantAPhoto();
    await request(apiService.server)
      .delete(`/zuvinimasnew/api/fishStockingPhotos/${photoId}`)
      .set(apiHelper.headers({ token: apiHelper.admin.token }))
      .expect(200);
  });
});
