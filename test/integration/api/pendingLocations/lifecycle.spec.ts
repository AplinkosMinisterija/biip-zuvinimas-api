'use strict';
// Lifecycle of a staged (non-UETK) water body: GRPK proposal → request →
// admin approve (mints NR-######) → resolve → linkToUetk rewrites stockings.
// Hits the live GRPK ArcGIS service for the Naikupė point — that is
// intentional, it is the only thing that proves the whole chain works.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

// Naikupė, Nemunas delta — verified absent from UETK on 2026-09-21.
const NAIKUPE = { x: 328452, y: 6133555 };
// An actual vertex on the Naikupė centre line (GRPK layer 20), ~497 m from
// NAIKUPE along the river. The brief's original value (328950, 6133300) was
// unverified and sits 200-300 m off the river — corrected per coordinator.
const NAIKUPE_500M_AWAY = { x: 328949, y: 6133566 };

const API = '/zuvinimasnew/api';

// GEO_SERVER points at an intentionally-invalid host in tests (see
// test/helpers/setup.js) so an accidental real WFS call fails loudly.
// pendingLocations.request looks up the municipality via
// locations.getMunicipalityFromPointXY, which hits GEO_SERVER — stub only
// that one host; the live GRPK ArcGIS calls this spec depends on still go
// through the real fetch.
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = ((url: string | URL, init?: RequestInit) => {
    if (`${url}`.startsWith(process.env.GEO_SERVER as string)) {
      return Promise.resolve({
        json: async () => ({
          features: [{ properties: { kodas: '88', pavadinimas: 'Šilutės r. sav.' } }],
        }),
      }) as ReturnType<typeof fetch>;
    }
    return realFetch(url, init);
  }) as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();
});
afterAll(async () => {
  await apiHelper.stop();
});

describe('pendingLocations lifecycle', () => {
  let id: number;

  it('creates one request from a GRPK proposal', async () => {
    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/request`)
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .send(NAIKUPE)
      .expect(200);
    expect(res.body.name).toBe('Naikupė');
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.grpkTopIds.length).toBeGreaterThan(1);
    id = res.body.id;
  });

  it('reuses the same row for a second click on the same river', async () => {
    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/request`)
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .send(NAIKUPE_500M_AWAY)
      .expect(200);
    expect(res.body.id).toBe(id);
  });

  it('refuses approval for a non-admin', async () => {
    // This gateway returns 401 (not 403) for every RestrictionType failure —
    // see api.service.ts:authorize, consistent with the existing regression
    // tests in test/integration/api/security/authorization.spec.ts.
    await request(apiService.server)
      .post(`${API}/pendingLocations/${id}/approve`)
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .expect(401);
  });

  it('mints a reserved cadastral id on admin approval', async () => {
    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/${id}/approve`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .expect(200);
    expect(res.body.cadastralId).toMatch(/^NR-\d{6}$/);
    expect(res.body.status).toBe('APPROVED');
  });

  it('resolves the approved row at the clicked point', async () => {
    const location = await apiService.broker.call('pendingLocations.resolveAtPoint', NAIKUPE);
    expect(location).toMatchObject({ name: 'Naikupė' });
    expect((location as { cadastral_id: string }).cadastral_id).toMatch(/^NR-\d{6}$/);
  });

  it('rewrites every stocking to the real id once AAA registers it in UETK', async () => {
    const reserved = `NR-${String(id).padStart(6, '0')}`;
    await apiHelper.createCompletedFishStocking({
      location: {
        cadastral_id: reserved,
        name: 'Naikupė',
        municipality: { id: 88, name: 'Šilutės r. sav.' },
      },
    });

    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/${id}/linkToUetk`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .send({ uetkCadastralId: '10099999' })
      .expect(200);
    expect(res.body.updated).toBe(1);

    const remaining = await apiHelper.countStockingsByCadastralId(reserved);
    expect(remaining).toBe(0);
    expect(await apiHelper.countStockingsByCadastralId('10099999')).toBe(1);
  });

  it('keeps two different water bodies distinct in the recent_locations view', async () => {
    await apiHelper.createCompletedFishStocking({
      location: {
        cadastral_id: 'NR-000999',
        name: 'Šmulžiogis',
        municipality: { id: 88, name: 'Šilutės r. sav.' },
      },
    });
    const names = await apiHelper.recentLocationNames();
    expect(new Set(names)).toEqual(new Set(['Naikupė', 'Šmulžiogis']));
  });
});
