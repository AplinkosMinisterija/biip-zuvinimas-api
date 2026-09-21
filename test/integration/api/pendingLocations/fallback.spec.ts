'use strict';
// Fallback chain for locations.search when UETK has no object at the clicked
// point: pendingLocations staging register first, then a live GRPK proposal.
// Hits the live GRPK ArcGIS service for the Šmulžiogis point — that is
// intentional, it is the only thing that proves the whole chain works.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

// GEO_SERVER points at an intentionally-invalid host in tests (see
// test/helpers/setup.js). getRiverOrLakeFromPoint's UETK rivers/lakes/
// municipality WFS calls all go through it — stub only that host so the UETK
// side resolves to "nothing here" (empty features) instead of throwing on a
// bad hostname, while the live GRPK ArcGIS call this spec depends on still
// goes through the real fetch.
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = ((url: string | URL, init?: RequestInit) => {
    if (`${url}`.startsWith(process.env.GEO_SERVER as string)) {
      return Promise.resolve({
        json: async () => ({ features: [] }),
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

// Šmulžiogis — in GRPK, not in UETK.
const geom = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [329527, 6132126] } },
  ],
});

describe('locations fallback chain', () => {
  it('offers a GRPK candidate when UETK has nothing at the point', async () => {
    const result: Array<{ name: string; source: string; cadastral_id: string | null }> =
      await apiService.broker.call('locations.search', { geom });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Šmulžiogis', source: 'GRPK_CANDIDATE' });
    expect(result[0].cadastral_id).toBeNull();
  });
});
