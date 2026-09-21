'use strict';
// Lifecycle of a staged (non-UETK) water body: GRPK proposal → request →
// admin approve (mints NR-######) → resolve → linkToUetk rewrites stockings.
// Hits the live GRPK ArcGIS service for the Naikupė point — that is
// intentional, it is the only thing that proves the whole chain works.

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';
import { GrpkCluster, GrpkLayer } from '../../../../modules/grpk';

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

/** Poll `check` until it resolves truthy, or throw once `timeoutMs` elapses. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error('waitFor: condition not met within timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** A minimal, fully synthetic GrpkCluster — no live GRPK call involved. */
function syntheticCluster(name: string, x: number, y: number): GrpkCluster {
  return {
    name,
    layers: [GrpkLayer.WATERCOURSES],
    primaryLayer: GrpkLayer.WATERCOURSES,
    topIds: ['synthetic-top-id'],
    geom: {
      type: 'MultiLineString',
      coordinates: [[[x, y], [x + 50, y + 50]]],
    },
  };
}

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

  it('reuses the same row for a second click on the same river, via the proximity match rather than the constraint fallback', async () => {
    const service: any = apiHelper.broker.getLocalService('pendingLocations');
    // If findRowAtPoint's proximity check had failed to match, this request
    // would still return the right id (the exclusion-constraint catch in
    // createFromCluster would rescue it) — but for the wrong reason, and
    // this test would stay green even if the proximity match were broken.
    // Prove the fast path actually fired.
    const createFromClusterSpy = jest.spyOn(service, 'createFromCluster');
    try {
      const res = await request(apiService.server)
        .post(`${API}/pendingLocations/request`)
        .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
        .send(NAIKUPE_500M_AWAY)
        .expect(200);
      expect(res.body.id).toBe(id);
      expect(createFromClusterSpy).not.toHaveBeenCalled();
    } finally {
      createFromClusterSpy.mockRestore();
    }

    const count = await apiService.broker.call('pendingLocations.count', {
      query: { name: 'Naikupė' },
    });
    expect(count).toBe(1);
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

  it('404s approving a location id that does not exist', async () => {
    await request(apiService.server)
      .post(`${API}/pendingLocations/999999999/approve`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .expect(404);
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
    // linkToUetk now updates only its own row and returns it — the
    // fish_stockings rewrite happens in a fishStockings event handler,
    // reacting to the emitted `pendingLocations.registeredInUetk` event.
    expect(res.body.status).toBe('REGISTERED_IN_UETK');
    expect(res.body.uetkCadastralId).toBe('10099999');

    // The rewrite is asynchronous (the event is emitted, not awaited, so a
    // real second consumer service is never blocked on) — poll for it.
    await waitFor(async () => (await apiHelper.countStockingsByCadastralId('10099999')) === 1);
    expect(await apiHelper.countStockingsByCadastralId(reserved)).toBe(0);
  });

  it('refuses a new request for a point already registered in UETK', async () => {
    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/request`)
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .send(NAIKUPE)
      .expect(409);
    expect(res.body.type).toBe('ALREADY_IN_UETK');
    expect(res.body.data.cadastralId).toBe('10099999');
  });
});

describe('reject', () => {
  const service = () => apiHelper.broker.getLocalService('pendingLocations') as any;

  it('rejects a REQUESTED row', async () => {
    const row = await service().createEntity(null, {
      name: 'RejectHappyPath',
      status: 'REQUESTED',
      grpkTopIds: ['synthetic'],
      grpkLayer: GrpkLayer.WATER_BODIES,
      municipality: { id: 1, name: 'Test' },
      geom: syntheticCluster('RejectHappyPath', 601000, 6001000).geom,
    });

    const res = await request(apiService.server)
      .post(`${API}/pendingLocations/${row.id}/reject`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .expect(200);
    expect(res.body.status).toBe('REJECTED');
  });

  it('refuses to reject an already-APPROVED row', async () => {
    const row = await service().createEntity(null, {
      name: 'RejectGuard',
      status: 'REQUESTED',
      grpkTopIds: ['synthetic'],
      grpkLayer: GrpkLayer.WATER_BODIES,
      municipality: { id: 1, name: 'Test' },
      geom: syntheticCluster('RejectGuard', 602000, 6002000).geom,
    });
    await request(apiService.server)
      .post(`${API}/pendingLocations/${row.id}/approve`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .expect(200);

    await request(apiService.server)
      .post(`${API}/pendingLocations/${row.id}/reject`)
      .set('Authorization', `Bearer ${apiHelper.admin.token}`)
      .expect(422);
  });
});

describe('createFromCluster overlap-constraint fallback', () => {
  it('returns the live row at the click point, not just any row sharing the name', async () => {
    const service = apiHelper.broker.getLocalService('pendingLocations') as any;
    const name = 'Testinė upė';

    // Two distinct, non-overlapping same-name rivers are deliberately legal
    // under the exclusion constraint.
    const farRow = await service.createFromCluster(
      null,
      500000,
      6000000,
      syntheticCluster(name, 500000, 6000000),
      { id: 1, name: 'Far' },
    );
    const nearRow = await service.createFromCluster(
      null,
      340000,
      6140000,
      syntheticCluster(name, 340000, 6140000),
      { id: 1, name: 'Near' },
    );
    expect(farRow.id).not.toBe(nearRow.id);

    // A cluster whose bbox overlaps nearRow's (same name) collides with
    // nearRow specifically. Matching by name alone (the old bug) could have
    // returned farRow just as easily.
    const resolved = await service.createFromCluster(
      null,
      340005,
      6140005,
      syntheticCluster(name, 340005, 6140005),
      { id: 1, name: 'Near' },
    );
    expect(resolved.id).toBe(nearRow.id);
  });
});

describe('write actions are disabled outright, not merely gated', () => {
  // create/update/remove/createMany are removed from the schema entirely
  // (DbConnection({ createActions: {...} })), so even a direct broker call —
  // the exact threat this guards against, since ctx.call has no gateway/auth
  // in the path at all — has no action to land on.
  it.each(['create', 'update', 'remove', 'createMany'])(
    '%s is not a callable action',
    async (action) => {
      await expect(
        apiService.broker.call(`pendingLocations.${action}`, { id: 1, name: 'x' }),
      ).rejects.toThrow();
    },
  );
});
