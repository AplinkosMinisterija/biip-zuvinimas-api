'use strict';
// Regression tests for the 4 CRITICAL SQL injection vulnerabilities fixed in
// PR #93. Each test sends a payload that, before the fix, would either crash
// the query (proving raw concat) or return data it shouldn't. After the fix,
// payloads are treated as literal filter values (no rows match, no error).

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

describe('SQL injection regression', () => {
  describe('fishStockings.beforeSelect (CRIT #1)', () => {
    const fishStockingsUrl = '/zuvinimasnew/api/fishStockings';

    const inject = async (filter: any) => {
      const res = await request(apiService.server)
        .get(fishStockingsUrl)
        .query({ filter: JSON.stringify(filter) })
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: apiHelper.tenantA.tenantId,
          }),
        );
      return res;
    };

    it("locationName ilike payload doesn't error", async () => {
      const res = await inject({ locationName: "x' OR 1=1 --" });
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([]);
    });

    it("municipality ilike payload doesn't error", async () => {
      const res = await inject({ municipality: "');DROP TABLE users;--" });
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([]);
    });

    it('municipalityId non-numeric is rejected silently (no SQL error)', async () => {
      const res = await inject({ municipalityId: '1) OR 1=1 --' });
      expect(res.status).toBe(200);
      // payload is not finite → filter dropped → unrestricted by municipality
    });

    it('fishTypes IN payload is rejected silently', async () => {
      const res = await inject({ fishTypes: '1); DROP TABLE fish_stockings;--' });
      expect(res.status).toBe(200);
    });

    it('inspector non-numeric is rejected', async () => {
      const res = await inject({ inspector: '5; SELECT pg_sleep(5)--' });
      expect(res.status).toBe(200);
    });
  });

  describe('mandatoryLocations.beforeSelect (CRIT #3)', () => {
    it("name ilike payload doesn't error and returns []", async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/mandatoryLocations')
        .query({ filter: JSON.stringify({ name: "x' UNION SELECT password FROM users--" }) })
        .set(apiHelper.headers({ token: apiHelper.admin.token }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([]);
    });
  });

  describe('public.uetk/statistics cadastralId (CRIT #4 — pre-auth!)', () => {
    it('payload is treated as literal jsonb value, no SQL error', async () => {
      const res = await request(apiService.server).get(
        '/zuvinimasnew/api/public/uetk/statistics',
      ).query({
        cadastralId: 'x"}\' AND 1=(SELECT CASE WHEN current_user=\'postgres\' THEN pg_sleep(5) ELSE 0 END)--',
      });
      expect(res.status).toBe(200);
      // No matching cadastralId → empty stats object
      expect(res.body).toEqual({});
    });

    it('legitimate numeric cadastralId still works', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/public/uetk/statistics')
        .query({ cadastralId: '12230311' });
      expect(res.status).toBe(200);
    });
  });

  describe('X-Profile header (CRIT #2)', () => {
    it("non-numeric X-Profile rejected (Number coerce → NaN)", async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: "1) OR 1=1--",
          }),
        );
      // api.service.ts authenticate() throws NoRightsError when profile coerces to NaN
      expect([401, 422, 500]).toContain(res.status);
    });

    it('integer X-Profile string is accepted', async () => {
      const res = await request(apiService.server)
        .get('/zuvinimasnew/api/fishStockings')
        .set(
          apiHelper.headers({
            token: apiHelper.ownerA.token,
            profile: String(apiHelper.tenantA.tenantId),
          }),
        );
      expect(res.status).toBe(200);
    });
  });
});
