'use strict';
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

describe('Smoke — broker boots + /ping responds', () => {
  it('GET /zuvinimasnew/ping returns 200', async () => {
    await request(apiService.server)
      .get('/zuvinimasnew/ping')
      .expect(200)
      .expect((res: any) => {
        expect(typeof res.body.timestamp).toBe('number');
      });
  });

  it('GET /zuvinimasnew/api/settings/ unauthenticated → 401', async () => {
    await request(apiService.server).get('/zuvinimasnew/api/settings/').expect(401);
  });

  it('GET /zuvinimasnew/api/settings/ with USER token → 200', async () => {
    await request(apiService.server)
      .get('/zuvinimasnew/api/settings/')
      .set(apiHelper.headers({ token: apiHelper.ownerA.token, profile: apiHelper.tenantA.tenantId }))
      .expect(200)
      .expect((res: any) => {
        expect(res.body.maxTimeForRegistration).toBe(10);
      });
  });
});
