# Unregistered water bodies (GRPK bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people register fish stocking on a real water body that UETK has not registered, without creating a second cadastre or duplicate water-body identities.

**Architecture:** When the UETK WFS lookup at a clicked point returns nothing, fall back to (1) already-approved rows in a new `pendingLocations` table, then (2) a live GRPK ArcGIS query that *proposes* a name and geometry. A proposal becomes a request; an AAA administrator approves it, which mints a reserved-namespace cadastral id `NR-######`. Identity is spatial — the row stores the merged geometry of the whole connected same-name GRPK cluster — so a click anywhere along the object resolves to the same row. When AAA later registers the object in UETK, one service action rewrites every affected stocking to the real cadastral id and retires the row.

**Tech Stack:** TypeScript, Moleculer.js + moleculer-decorators, moleculer-postgis, Knex (camelCase migrations via `knexSnakeCaseMappers`), Objection, PostgreSQL + PostGIS (SRID 3346), Jest + supertest; React 18 + Vite + TanStack Query + Formik + styled-components on the two frontends.

**Spec:** `docs/superpowers/specs/2026-09-21-unregistered-water-bodies.md`

## Global Constraints

- Package manager is **Yarn** in all three repos. Never run `npm`/`pnpm`.
- TypeScript `strict: true`. No `any` — unknown input is `unknown` and narrowed.
- Migrations are written in **camelCase**; `knexSnakeCaseMappers()` in `knexfile.ts` maps them to snake_case in the database. Raw SQL must use snake_case (`pending_locations`, `fish_stockings`, `cadastral_id`).
- SRID is **3346** (LKS94) everywhere geometry is stored or queried.
- Reserved cadastral-id namespace is `NR-` followed by 6 zero-padded digits (`NR-000001`). Real UETK cadastral ids always start with a digit — never mint an id that starts with a digit.
- GRPK endpoint: `https://www.geoportal.lt/mapproxy/gisc_grpk/MapServer`, layer `19` = water bodies (polygons), layer `20` = watercourse centre lines (polylines). Public, no auth. It answers `f=json` only — **`f=geojson` returns `Bad Request`**, and a `where`-only query without a geometry filter also returns `Bad Request`. Every query must carry a geometry filter.
- Frontend work follows WCAG 2.1 AA (legal requirement): every control has an accessible name, errors wired via `aria-describedby` + `aria-invalid`, and fields go through the repo's shared field components.
- Lithuanian is for user-facing copy only. Code, identifiers, comments and docs are English.
- **The `pendingLocations` table and service must stay portable** (spec decision 8): `biip-zvejyba-api` has the same gap and will consume this register over `INTERNAL_API`. No žuvinimas-specific column, field or assumption may enter the table, the service or its REST surface; anything žuvinimas-only belongs in `fishStockings`. The reserved id must mean the same thing to any consumer.
- Commit after every task.

## Repos and file structure

**`biip-zuvinimas-api`** (primary)

| File | Responsibility |
|---|---|
| Create `modules/grpk.ts` | GRPK ArcGIS client: find a named water feature at a point, fetch its same-name cluster, convert esriJSON to GeoJSON |
| Create `database/migrations/20260921120000_pendingLocations.js` | `pendingLocations` table, `btree_gist`, overlap exclusion constraint |
| Create `services/pendingLocations.service.ts` | The staging register: resolve at point, create request, approve/reject, link to UETK |
| Modify `services/locations.service.ts:253` | Fallback chain after the UETK WFS miss |
| Modify `services/public.service.ts:232-281` | Exclude `NR-%` from UETK-facing statistics |
| Create `test/unit/grpk.spec.ts` | esriJSON conversion and cluster merging |
| Create `test/integration/api/pendingLocations/lifecycle.spec.ts` | request → approve → register stocking → link to UETK |
| Create `docs/adr/0001-unregistered-water-bodies.md`, modify `CONTEXT.md` | Decision record and glossary |

**`biip-zuvinimas-web`** — `src/components/other/RegistrationMap.tsx`, `src/utils/api.ts`, `src/utils/types.ts`, `src/utils/texts.ts`

**`biip-admin-web`** — `src/modules/zuvinimas/pages/PendingLocations.tsx`, `src/modules/zuvinimas/pages/PendingLocation.tsx`, `src/modules/zuvinimas/api.ts`, `src/modules/zuvinimas/utils/router.tsx`, `src/modules/zuvinimas/utils/texts.ts`

## Acceptance checklist

Walk each item against the running system before calling this done. "It compiles" is not done.

- [ ] A1 Clicking LKS94 `328452, 6133555` offers "Naikupė" instead of "Nerastas telkinys".
- [ ] A2 Clicking LKS94 `329527, 6132126` offers "Šmulžiogis".
- [ ] A3 Submitting the request creates exactly one `pendingLocations` row, `status=REQUESTED`, with the merged GRPK geometry (23 segments for Naikupė, 2 polygons for Šmulžiogis).
- [ ] A4 A second click 500 m away along Naikupė reuses that row — the table still has one Naikupė row.
- [ ] A5 After AAA approves, a fish stocking registers end to end on the water body.
- [ ] A6 The registered stocking renders on the public map at the clicked point.
- [ ] A7 `recent_locations` and `getLocationsCount` treat Naikupė and Šmulžiogis as two distinct objects.
- [ ] A8 `GET /public/uetk/statistics` returns no key starting with `NR-`.
- [ ] A9 `pendingLocations.linkToUetk` rewrites every affected stocking's `cadastral_id` to the real UETK id, and the object then resolves through the normal UETK path.
- [ ] A10 A non-admin cannot approve a request (403).

---

### Task 1: GRPK client module

**Files:**
- Create: `modules/grpk.ts`
- Test: `test/unit/grpk.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GrpkLayer` — `enum { WATER_BODIES = 19, WATERCOURSES = 20 }`
  - `type GrpkCluster = { name: string; layer: GrpkLayer; topIds: string[]; geom: MultiPolygonGeoJSON | MultiLineStringGeoJSON }`
  - `esriToGeoJson(geometryType: string, geometry: EsriGeometry): MultiPolygonGeoJSON | MultiLineStringGeoJSON`
  - `mergeCluster(name: string, layer: GrpkLayer, features: EsriFeature[]): GrpkCluster`
  - `findClusterAtPoint(x: number, y: number, toleranceMeters?: number, radiusMeters?: number): Promise<GrpkCluster | null>`

- [ ] **Step 1: Write the failing unit test**

```ts
// test/unit/grpk.spec.ts
'use strict';
import { describe, expect, it } from '@jest/globals';
import { GrpkLayer, esriToGeoJson, mergeCluster } from '../../modules/grpk';

// ArcGIS rings: outer ring clockwise (negative shoelace), hole counter-clockwise.
const ringsWithHole = {
  rings: [
    [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
    [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
  ],
};

describe('esriToGeoJson', () => {
  it('keeps a hole inside its outer ring instead of making a second polygon', () => {
    const geom = esriToGeoJson('esriGeometryPolygon', ringsWithHole);
    expect(geom.type).toBe('MultiPolygon');
    expect(geom.coordinates).toHaveLength(1);
    expect(geom.coordinates[0]).toHaveLength(2);
  });

  it('converts polyline paths to a MultiLineString', () => {
    const geom = esriToGeoJson('esriGeometryPolyline', {
      paths: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]],
    });
    expect(geom).toEqual({
      type: 'MultiLineString',
      coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]],
    });
  });
});

describe('mergeCluster', () => {
  it('merges every same-name feature into one geometry and keeps all TOP_IDs', () => {
    const cluster = mergeCluster('Naikupė', GrpkLayer.WATERCOURSES, [
      { attributes: { TOP_ID: 'a', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[0, 0], [1, 1]]] } },
      { attributes: { TOP_ID: 'b', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[1, 1], [2, 2]]] } },
    ]);
    expect(cluster.topIds).toEqual(['a', 'b']);
    expect(cluster.geom.coordinates).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn jest test/unit/grpk.spec.ts`
Expected: FAIL — `Cannot find module '../../modules/grpk'`.

- [ ] **Step 3: Implement the module**

```ts
// modules/grpk.ts
'use strict';

export const GRPK_MAP_SERVER = 'https://www.geoportal.lt/mapproxy/gisc_grpk/MapServer';

export enum GrpkLayer {
  WATER_BODIES = 19,
  WATERCOURSES = 20,
}

type Ring = number[][];

export type EsriGeometry = { rings?: Ring[]; paths?: Ring[] };
export type EsriFeature = {
  attributes: { TOP_ID: string; VARDAS: string | null; GKODAS: string };
  geometry: EsriGeometry;
};

export type MultiPolygonGeoJson = { type: 'MultiPolygon'; coordinates: Ring[][] };
export type MultiLineStringGeoJson = { type: 'MultiLineString'; coordinates: Ring[] };
export type GrpkGeometry = MultiPolygonGeoJson | MultiLineStringGeoJson;

export type GrpkCluster = {
  name: string;
  layer: GrpkLayer;
  topIds: string[];
  geom: GrpkGeometry;
};

// Shoelace: ArcGIS draws outer rings clockwise (negative area) and holes
// counter-clockwise. Losing that distinction would turn a lake's island into
// a second lake.
const isOuterRing = (ring: Ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum < 0;
};

export function esriToGeoJson(geometryType: string, geometry: EsriGeometry): GrpkGeometry {
  if (geometryType === 'esriGeometryPolyline') {
    return { type: 'MultiLineString', coordinates: geometry.paths || [] };
  }
  const polygons: Ring[][] = [];
  for (const ring of geometry.rings || []) {
    if (isOuterRing(ring) || !polygons.length) {
      polygons.push([ring]);
    } else {
      polygons[polygons.length - 1].push(ring);
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

export function mergeCluster(
  name: string,
  layer: GrpkLayer,
  features: EsriFeature[],
): GrpkCluster {
  const geometryType =
    layer === GrpkLayer.WATERCOURSES ? 'esriGeometryPolyline' : 'esriGeometryPolygon';
  const parts = features.map((f) => esriToGeoJson(geometryType, f.geometry));
  const coordinates = parts.flatMap((p) => p.coordinates as never[]);
  return {
    name,
    layer,
    topIds: features.map((f) => f.attributes.TOP_ID),
    geom:
      layer === GrpkLayer.WATERCOURSES
        ? { type: 'MultiLineString', coordinates: coordinates as Ring[] }
        : { type: 'MultiPolygon', coordinates: coordinates as Ring[][] },
  };
}

async function query(layer: GrpkLayer, params: Record<string, string>): Promise<{
  geometryType?: string;
  features?: EsriFeature[];
}> {
  const url = `${GRPK_MAP_SERVER}/${layer}/query?${new URLSearchParams({
    f: 'json',
    ...params,
  })}`;
  const response = await fetch(url);
  const text = await response.text();
  try {
    return JSON.parse(text) as { geometryType?: string; features?: EsriFeature[] };
  } catch {
    // The proxy answers plain "Bad Request" for unsupported queries.
    throw new Error(`GRPK query failed for layer ${layer}: ${text.slice(0, 120)}`);
  }
}

/**
 * Find the named GRPK water feature at a point, then return its whole
 * same-name cluster. `radiusMeters` bounds the cluster query — a click far
 * along a very long object can therefore produce a partial cluster; the
 * pendingLocations overlap constraint merges those cases instead of
 * duplicating them.
 */
export async function findClusterAtPoint(
  x: number,
  y: number,
  toleranceMeters = 25,
  radiusMeters = 11000,
): Promise<GrpkCluster | null> {
  const point = JSON.stringify({ x, y, spatialReference: { wkid: 3346 } });
  for (const layer of [GrpkLayer.WATER_BODIES, GrpkLayer.WATERCOURSES]) {
    const hit = await query(layer, {
      geometry: point,
      geometryType: 'esriGeometryPoint',
      inSR: '3346',
      distance: String(toleranceMeters),
      units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'TOP_ID,VARDAS,GKODAS',
      returnGeometry: 'false',
    });
    const named = hit.features?.find((f) => !!f.attributes.VARDAS?.trim());
    if (!named) continue;

    const name = named.attributes.VARDAS as string;
    const envelope = JSON.stringify({
      xmin: x - radiusMeters,
      ymin: y - radiusMeters,
      xmax: x + radiusMeters,
      ymax: y + radiusMeters,
      spatialReference: { wkid: 3346 },
    });
    const cluster = await query(layer, {
      geometry: envelope,
      geometryType: 'esriGeometryEnvelope',
      inSR: '3346',
      spatialRel: 'esriSpatialRelIntersects',
      where: `VARDAS = '${name.replace(/'/g, "''")}'`,
      outFields: 'TOP_ID,VARDAS,GKODAS',
      returnGeometry: 'true',
      outSR: '3346',
    });
    return mergeCluster(name, layer, cluster.features || []);
  }
  return null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `yarn jest test/unit/grpk.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify against the live service**

Run:
```bash
npx ts-node -e "import('./modules/grpk').then(async (m) => {
  console.log(JSON.stringify((await m.findClusterAtPoint(328452, 6133555))?.topIds.length));
  console.log(JSON.stringify((await m.findClusterAtPoint(329527, 6132126))?.name));
})"
```
Expected: `23` then `"Šmulžiogis"`.

- [ ] **Step 6: Commit**

```bash
git add modules/grpk.ts test/unit/grpk.spec.ts
git commit -m "zuvinimas: add GRPK ArcGIS client for unregistered water bodies"
```

---

### Task 2: `pendingLocations` table

**Files:**
- Create: `database/migrations/20260921120000_pendingLocations.js`

**Interfaces:**
- Produces: table `pending_locations` with columns `id`, `name`, `cadastral_id`, `uetk_cadastral_id`, `status`, `geom`, `grpk_top_ids`, `grpk_layer`, `municipality`, plus the common audit fields. Task 3 reads and writes it.

- [ ] **Step 1: Write the migration**

```js
// database/migrations/20260921120000_pendingLocations.js
const { commonFields } = require('./20230405144107_setup');

exports.up = async function (knex) {
  // btree_gist lets an exclusion constraint mix an equality test on text with
  // a bounding-box overlap test on geometry.
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

  await knex.schema.createTable('pendingLocations', (table) => {
    table.increments('id');
    table.string('name', 255).notNullable();
    // Reserved namespace NR-######; minted on approval, never null afterwards.
    table.string('cadastralId', 32).unique();
    // The real UETK id, once AAA registers the object. Marks the row retired.
    table.string('uetkCadastralId', 32);
    table
      .enu('status', ['REQUESTED', 'APPROVED', 'REJECTED', 'REGISTERED_IN_UETK'])
      .notNullable()
      .defaultTo('REQUESTED');
    table.specificType('grpkTopIds', 'text[]');
    table.integer('grpkLayer');
    table.jsonb('municipality');
    commonFields(table);
  });

  await knex.raw(
    `ALTER TABLE pending_locations ADD COLUMN geom geometry(Geometry, 3346) NOT NULL`,
  );
  await knex.raw(`CREATE INDEX pending_locations_geom_idx ON pending_locations USING gist (geom)`);

  // One live row per real-world water body: a second row with the same name
  // whose bounding box overlaps an existing live row is rejected outright.
  // Two genuinely different "Naikupė" rivers do not overlap, so both stay legal.
  await knex.raw(`
    ALTER TABLE pending_locations
      ADD CONSTRAINT pending_locations_no_overlap
      EXCLUDE USING gist (lower(name) WITH =, geom WITH &&)
      WHERE (status IN ('REQUESTED', 'APPROVED') AND deleted_at IS NULL)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTable('pendingLocations');
};
```

- [ ] **Step 2: Apply it against the test database**

Run: `DB_CONNECTION=postgresql://postgres:postgres@localhost:5449/zuvinimas_test yarn db:migrate`
Expected: `Batch N run: 1 migrations`.

- [ ] **Step 3: Prove the constraint actually blocks a duplicate**

Run:
```bash
psql postgresql://postgres:postgres@localhost:5449/zuvinimas_test -c "
INSERT INTO pending_locations (name, status, geom) VALUES
  ('Naikupė','REQUESTED', ST_GeomFromText('LINESTRING(328000 6133000, 329000 6133500)', 3346));
INSERT INTO pending_locations (name, status, geom) VALUES
  ('Naikupė','REQUESTED', ST_GeomFromText('LINESTRING(328500 6133200, 330000 6133600)', 3346));"
```
Expected: the second INSERT fails with `conflicting key value violates exclusion constraint "pending_locations_no_overlap"`.

- [ ] **Step 4: Prove two distinct same-name rivers are still allowed**

Run:
```bash
psql postgresql://postgres:postgres@localhost:5449/zuvinimas_test -c "
INSERT INTO pending_locations (name, status, geom) VALUES
  ('Naikupė','REQUESTED', ST_GeomFromText('LINESTRING(477000 6120000, 477500 6120500)', 3346));
DELETE FROM pending_locations;"
```
Expected: INSERT succeeds.

- [ ] **Step 5: Run the rollback and re-apply**

Run: `DB_CONNECTION=... yarn knex migrate:rollback && DB_CONNECTION=... yarn db:migrate`
Expected: both succeed — a bad `down()` breaks every future deploy, because the API runs migrations on boot.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/20260921120000_pendingLocations.js
git commit -m "zuvinimas: add pendingLocations table with overlap exclusion constraint"
```

---

### Task 3: `pendingLocations` service

**Files:**
- Create: `services/pendingLocations.service.ts`
- Test: `test/integration/api/pendingLocations/lifecycle.spec.ts`

**Interfaces:**
- Consumes: `findClusterAtPoint`, `GrpkCluster`, `GrpkLayer` from Task 1; the table from Task 2; `Location` from `services/locations.service.ts`.
- Produces:
  - `pendingLocations.resolveAtPoint({ x, y }) → Location | null` — an approved row as a normal `Location` (`cadastral_id: 'NR-000001'`).
  - `pendingLocations.proposeAtPoint({ x, y }) → { name, geom, grpkTopIds, grpkLayer } | null` — a GRPK proposal, not selectable.
  - `pendingLocations.request({ x, y }) → PendingLocation` — creates or reuses a `REQUESTED` row. `RestrictionType.USER`.
  - `pendingLocations.approve({ id }) → PendingLocation` — mints `NR-######`. `RestrictionType.ADMIN`.
  - `pendingLocations.reject({ id }) → PendingLocation`. `RestrictionType.ADMIN`.
  - `pendingLocations.linkToUetk({ id, uetkCadastralId }) → { updated: number }`. `RestrictionType.ADMIN`.

- [ ] **Step 1: Write the failing integration test**

```ts
// test/integration/api/pendingLocations/lifecycle.spec.ts
'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

// Naikupė, Nemunas delta — verified absent from UETK on 2026-09-21.
const NAIKUPE = { x: 328452, y: 6133555 };
const NAIKUPE_500M_AWAY = { x: 328950, y: 6133300 };

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
      .post('/pendingLocations/request')
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
      .post('/pendingLocations/request')
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .send(NAIKUPE_500M_AWAY)
      .expect(200);
    expect(res.body.id).toBe(id);
  });

  it('refuses approval for a non-admin', async () => {
    await request(apiService.server)
      .post(`/pendingLocations/${id}/approve`)
      .set('Authorization', `Bearer ${apiHelper.ownerA.token}`)
      .expect(403);
  });

  it('mints a reserved cadastral id on admin approval', async () => {
    const res = await request(apiService.server)
      .post(`/pendingLocations/${id}/approve`)
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
      .post(`/pendingLocations/${id}/linkToUetk`)
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
```

`ApiHelper` needs three small fixtures for this file — add them to
`test/helpers/api.ts` alongside the existing ones:
`createCompletedFishStocking({ location })`,
`countStockingsByCadastralId(id)` (`SELECT count(*) FROM fish_stockings WHERE
location::jsonb->>'cadastral_id' = ?`) and `recentLocationNames()`
(`SELECT name FROM recent_locations`).

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test test/integration/api/pendingLocations/lifecycle.spec.ts`
Expected: FAIL — `Service 'pendingLocations' is not found`.

- [ ] **Step 3: Implement the service**

```ts
// services/pendingLocations.service.ts
'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import { GrpkCluster, GrpkLayer, findClusterAtPoint } from '../modules/grpk';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  RestrictionType,
  Table,
} from '../types';
import { Location, Municipality } from './locations.service';

export enum PendingLocationStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REGISTERED_IN_UETK = 'REGISTERED_IN_UETK',
}

// UETK cadastral ids always start with a digit, so this prefix cannot collide.
const RESERVED_PREFIX = 'NR-';
// How close a click has to be to an existing row's geometry to count as the
// same water body. 25 m covers map-click imprecision without bridging two
// neighbouring water bodies.
const MATCH_TOLERANCE_M = 25;

interface Fields extends CommonFields {
  id: number;
  name: string;
  cadastralId: string | null;
  uetkCadastralId: string | null;
  status: PendingLocationStatus;
  grpkTopIds: string[];
  grpkLayer: number;
  municipality: Municipality;
  geom: unknown;
}

export type PendingLocation = Table<Fields, Record<string, never>, never, keyof Fields>;

@Service({
  name: 'pendingLocations',
  mixins: [DbConnection(), PostgisMixin({ srid: 3346 })],
  settings: {
    fields: {
      id: { type: 'number', primaryKey: true, secure: true },
      name: 'string|required',
      cadastralId: 'string',
      uetkCadastralId: 'string',
      status: 'string',
      grpkTopIds: { type: 'array', items: 'string', columnType: 'array' },
      grpkLayer: 'number',
      municipality: { type: 'object', columnType: 'json' },
      geom: { type: 'any', geom: { type: 'geom' } },
      ...COMMON_FIELDS,
    },
    scopes: { ...COMMON_SCOPES },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PendingLocationsService extends moleculer.Service {
  @Action({
    params: { x: 'number|convert', y: 'number|convert' },
    cache: false,
  })
  async resolveAtPoint(ctx: Context<{ x: number; y: number }>): Promise<Location | null> {
    const row = await this.findRowAtPoint(ctx, ctx.params.x, ctx.params.y, [
      PendingLocationStatus.APPROVED,
    ]);
    if (!row) return null;
    return {
      name: row.name,
      cadastral_id: row.cadastralId as string,
      municipality: row.municipality,
      area: undefined,
      length: undefined,
      category: row.grpkLayer === GrpkLayer.WATERCOURSES ? 'Upė' : 'Ežeras',
    } as Location;
  }

  @Action({
    params: { x: 'number|convert', y: 'number|convert' },
    cache: false,
  })
  async proposeAtPoint(ctx: Context<{ x: number; y: number }>) {
    const cluster = await findClusterAtPoint(ctx.params.x, ctx.params.y);
    if (!cluster) return null;
    return {
      name: cluster.name,
      grpkTopIds: cluster.topIds,
      grpkLayer: cluster.primaryLayer,
    };
  }

  @Action({
    rest: 'POST /request',
    auth: RestrictionType.USER,
    params: { x: 'number|convert', y: 'number|convert' },
  })
  async request(ctx: Context<{ x: number; y: number }>): Promise<PendingLocation> {
    const { x, y } = ctx.params;
    const existing = await this.findRowAtPoint(ctx, x, y, [
      PendingLocationStatus.REQUESTED,
      PendingLocationStatus.APPROVED,
    ]);
    if (existing) return existing;

    // The exclusion constraint only guards REQUESTED/APPROVED rows, so a row
    // already retired into UETK no longer blocks a duplicate at the database
    // level. The normal flow never gets here for such a point — the caller
    // hits UETK first — but this action is reachable directly, so the guard
    // belongs here rather than in the caller.
    const retired = await this.findRowAtPoint(ctx, x, y, [
      PendingLocationStatus.REGISTERED_IN_UETK,
    ]);
    if (retired) {
      throw new moleculer.Errors.MoleculerClientError(
        `Water body is already registered in UETK as ${retired.uetkCadastralId}`,
        409,
        'ALREADY_IN_UETK',
        { cadastralId: retired.uetkCadastralId },
      );
    }

    const cluster = await findClusterAtPoint(x, y);
    if (!cluster) {
      throw new moleculer.Errors.MoleculerClientError(
        'No water body found at this point',
        404,
        'WATER_BODY_NOT_FOUND',
      );
    }
    const municipality: Municipality = await ctx.call('locations.getMunicipalityFromPointXY', {
      x,
      y,
    });
    return this.createFromCluster(ctx, cluster, municipality);
  }

  @Action({
    rest: 'POST /:id/approve',
    auth: RestrictionType.ADMIN,
    params: { id: 'number|convert' },
  })
  async approve(ctx: Context<{ id: number }>): Promise<PendingLocation> {
    const row: PendingLocation = await this.resolveEntities(ctx, { id: ctx.params.id });
    if (row.status !== PendingLocationStatus.REQUESTED) {
      throw new moleculer.Errors.ValidationError('Only a REQUESTED location can be approved');
    }
    return this.updateEntity(ctx, {
      id: row.id,
      status: PendingLocationStatus.APPROVED,
      cadastralId: `${RESERVED_PREFIX}${String(row.id).padStart(6, '0')}`,
    });
  }

  @Action({
    rest: 'POST /:id/reject',
    auth: RestrictionType.ADMIN,
    params: { id: 'number|convert' },
  })
  async reject(ctx: Context<{ id: number }>): Promise<PendingLocation> {
    return this.updateEntity(ctx, {
      id: ctx.params.id,
      status: PendingLocationStatus.REJECTED,
    });
  }

  /**
   * The exit path: AAA registered the object in UETK, so every stocking that
   * carries the reserved id is rewritten to the real one and the row retires.
   */
  @Action({
    rest: 'POST /:id/linkToUetk',
    auth: RestrictionType.ADMIN,
    params: { id: 'number|convert', uetkCadastralId: 'string' },
  })
  async linkToUetk(ctx: Context<{ id: number; uetkCadastralId: string }>) {
    const row: PendingLocation = await this.resolveEntities(ctx, { id: ctx.params.id });
    if (!row.cadastralId) {
      throw new moleculer.Errors.ValidationError('Location has no reserved cadastral id');
    }
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    const { uetkCadastralId } = ctx.params;

    const updated = await knex.transaction(async (trx: any) => {
      const result = await trx.raw(
        `UPDATE fish_stockings
            SET location = jsonb_set(location::jsonb, '{cadastral_id}', to_jsonb(?::text))
          WHERE location::jsonb->>'cadastral_id' = ?`,
        [uetkCadastralId, row.cadastralId],
      );
      await trx('pending_locations')
        .where({ id: row.id })
        .update({
          uetk_cadastral_id: uetkCadastralId,
          status: PendingLocationStatus.REGISTERED_IN_UETK,
        });
      return result.rowCount as number;
    });

    return { updated };
  }

  async findRowAtPoint(
    ctx: Context,
    x: number,
    y: number,
    statuses: PendingLocationStatus[],
  ): Promise<PendingLocation | null> {
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    const { rows } = await knex.raw(
      `SELECT id FROM pending_locations
        WHERE deleted_at IS NULL
          AND status = ANY(?)
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(?, ?), 3346), ?)
        ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(?, ?), 3346))
        LIMIT 1`,
      [statuses, x, y, MATCH_TOLERANCE_M, x, y],
    );
    if (!rows.length) return null;
    return this.resolveEntities(ctx, { id: rows[0].id });
  }

  async createFromCluster(
    ctx: Context,
    cluster: GrpkCluster,
    municipality: Municipality,
  ): Promise<PendingLocation> {
    try {
      return await this.createEntity(ctx, {
        name: cluster.name,
        status: PendingLocationStatus.REQUESTED,
        grpkTopIds: cluster.topIds,
        grpkLayer: cluster.primaryLayer,
        municipality,
        geom: cluster.geom,
      });
    } catch (err) {
      // The overlap exclusion constraint fired: another row already represents
      // this water body (a click far along a long object produces a partial,
      // overlapping cluster). Reuse that row rather than failing the user.
      if (`${(err as Error).message}`.includes('pending_locations_no_overlap')) {
        const rows: PendingLocation[] = await ctx.call('pendingLocations.find', {
          query: { name: cluster.name },
        });
        if (rows.length) return rows[0];
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Add the helper action the service calls on `locations`**

In `services/locations.service.ts`, next to `getMunicipalityFromPoint`, add an action wrapper so `pendingLocations` does not have to build a GeoJSON FeatureCollection:

```ts
  @Action({
    params: { x: 'number|convert', y: 'number|convert' },
    cache: { ttl: 24 * 60 * 60 },
  })
  async getMunicipalityFromPointXY(ctx: Context<{ x: number; y: number }>) {
    return this.getMunicipalityFromPoint({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [ctx.params.x, ctx.params.y] },
        },
      ],
    } as GeomFeatureCollection);
  }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `yarn test test/integration/api/pendingLocations/lifecycle.spec.ts`
Expected: PASS, 7 tests. This covers acceptance items A3, A4, A7, A9 and A10.

- [ ] **Step 6: Commit**

```bash
git add services/pendingLocations.service.ts services/locations.service.ts \
        test/integration/api/pendingLocations/lifecycle.spec.ts
git commit -m "zuvinimas: add pendingLocations staging register for non-UETK water bodies"
```

---

### Task 4: fallback chain in `locations.search`

**Files:**
- Modify: `services/locations.service.ts:253-300` (`getRiverOrLakeFromPoint`)
- Test: `test/integration/api/pendingLocations/fallback.spec.ts`

**Interfaces:**
- Consumes: `pendingLocations.resolveAtPoint`, `pendingLocations.proposeAtPoint` from Task 3.
- Produces: `locations.search?geom=` may now return entries carrying `source: 'UETK' | 'PENDING' | 'GRPK_CANDIDATE'`. A `GRPK_CANDIDATE` entry has `cadastral_id: null` and must not be selectable — the frontend (Task 6) turns it into a request instead.

- [ ] **Step 1: Write the failing test**

```ts
// test/integration/api/pendingLocations/fallback.spec.ts
'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

// Šmulžiogis — in GRPK, not in UETK.
const geom = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [329527, 6132126] } },
  ],
});

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();
});
afterAll(async () => {
  await apiHelper.stop();
});

it('offers a GRPK candidate when UETK has nothing at the point', async () => {
  const result: Array<{ name: string; source: string; cadastral_id: string | null }> =
    await apiService.broker.call('locations.search', { geom });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ name: 'Šmulžiogis', source: 'GRPK_CANDIDATE' });
  expect(result[0].cadastral_id).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test test/integration/api/pendingLocations/fallback.spec.ts`
Expected: FAIL — received `[]`.

- [ ] **Step 3: Implement the fallback chain**

Replace the tail of `getRiverOrLakeFromPoint` (currently `return mappedList;`) with:

```ts
        if (mappedList.length) {
          return mappedList.map((item) => ({ ...item, source: 'UETK' }));
        }

        // UETK has nothing here. Fall back to an already-approved staging row,
        // then to a live GRPK proposal the user can request.
        const [x, y] = geom.features[0].geometry.coordinates as [number, number];
        const approved = await this.broker.call('pendingLocations.resolveAtPoint', { x, y });
        if (approved) {
          return [{ ...(approved as Location), source: 'PENDING' }];
        }

        const proposal: { name: string } | null = await this.broker.call(
          'pendingLocations.proposeAtPoint',
          { x, y },
        );
        if (!proposal) return [];

        return [
          {
            name: proposal.name,
            cadastral_id: null,
            municipality,
            source: 'GRPK_CANDIDATE',
          },
        ];
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `yarn test test/integration/api/pendingLocations/fallback.spec.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the UETK path is unchanged**

Run: `yarn test test/integration/api/fishStockings/lifecycle.spec.ts`
Expected: PASS — existing UETK-backed registration still works.

- [ ] **Step 6: Commit**

```bash
git add services/locations.service.ts test/integration/api/pendingLocations/fallback.spec.ts
git commit -m "zuvinimas: fall back to pending locations and GRPK when UETK has no object"
```

---

### Task 5: keep the reserved namespace out of UETK-facing statistics

**Files:**
- Modify: `services/public.service.ts:232-281`
- Test: `test/integration/api/pendingLocations/uetkStatistics.spec.ts`

**Interfaces:**
- Consumes: the `NR-` namespace from Task 3.
- Produces: no new interface — `/public/uetk/statistics` and `/public/uetk/statistics/byYear` never return an `NR-` key.

- [ ] **Step 1: Write the failing test**

```ts
// test/integration/api/pendingLocations/uetkStatistics.spec.ts
'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ApiHelper } from '../../../helpers/api';

const request = require('supertest');
const apiHelper = new ApiHelper();
const apiService = apiHelper.bootServices();

beforeAll(async () => {
  await apiHelper.start();
  await apiHelper.setup();
  await apiHelper.createCompletedFishStocking({
    location: {
      cadastral_id: 'NR-000001',
      name: 'Naikupė',
      municipality: { id: 88, name: 'Šilutės r. sav.' },
    },
  });
});
afterAll(async () => {
  await apiHelper.stop();
});

it('never exposes reserved NR- ids through the UETK statistics endpoint', async () => {
  const res = await request(apiService.server).get('/public/uetk/statistics').expect(200);
  expect(Object.keys(res.body).filter((k) => k.startsWith('NR-'))).toEqual([]);
});
```

If `ApiHelper` has no `createCompletedFishStocking`, add it in `test/helpers/api.ts` mirroring the existing fixture helpers — a completed stocking with the given `location` and one batch.

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test test/integration/api/pendingLocations/uetkStatistics.spec.ts`
Expected: FAIL — the array contains `NR-000001`.

- [ ] **Step 3: Filter the namespace out**

`services/public.service.ts:232-281` is the private batch builder that both
`uetkStatistics` and `uetkStatisticsByYear` call, so one change covers both.
It has no `appendRaw` helper (that one lives in `fishStockings.service.ts`) —
it builds `clauses: string[]` and `bindings: any[]` by hand. Add the filter
unconditionally, right before the `if (clauses.length)` block:

```ts
    // The NR- namespace belongs to the zuvinimas staging register, not to
    // UETK. Leaking it would put identifiers UETK does not own into the UETK
    // portal. Unconditional: it must hold for every call, filtered or not.
    clauses.push(`location::jsonb->>'cadastral_id' NOT LIKE 'NR-%'`);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `yarn test test/integration/api/pendingLocations/uetkStatistics.spec.ts`
Expected: PASS. This covers acceptance item A8.

- [ ] **Step 5: Commit**

```bash
git add services/public.service.ts test/integration/api/pendingLocations/uetkStatistics.spec.ts \
        test/helpers/api.ts
git commit -m "zuvinimas: exclude reserved NR- ids from UETK statistics endpoints"
```

---

### Task 6: registration map offers the request (biip-zuvinimas-web)

**Files:**
- Modify: `src/components/other/RegistrationMap.tsx:44-70,120-150`
- Modify: `src/utils/api.ts`, `src/utils/types.ts`, `src/utils/texts.ts`

**Interfaces:**
- Consumes: `source` and `cadastral_id: null` from Task 4; `POST /pendingLocations/request` from Task 3.
- Produces: no backend interface.

- [ ] **Step 1: Extend the types and the API client**

```ts
// src/utils/types.ts — add to FishStockingLocation
  source?: 'UETK' | 'PENDING' | 'GRPK_CANDIDATE';
```

```ts
// src/utils/api.ts
  requestPendingLocation = async (params: { x: number; y: number }): Promise<FishStockingLocation> =>
    await this.errorWrapper(() => this.post({ resource: 'pendingLocations/request', params }));
```

- [ ] **Step 2: Add the copy**

```ts
// src/utils/texts.ts
export const locationTexts = {
  notFound: 'Nerastas telkinys',
  grpkCandidate: 'Šis telkinys dar neįregistruotas UETK registre.',
  requestButton: 'Prašyti įtraukti telkinį',
  requested:
    'Prašymas pateiktas. Telkinį patvirtins Aplinkos apsaugos agentūra — tada galėsite registruoti žuvinimą.',
};
```

- [ ] **Step 3: Handle the candidate in the popup**

In `RegistrationMap.tsx`, keep `validItems` for selectable entries but stop discarding candidates. Replace the `validItems` filter and the `locations.length === 0` branch:

```tsx
        const selectable = items.filter(
          (item) => !!item?.municipality?.id && !!item?.cadastral_id,
        );
        const candidate = items.find((item) => item?.source === 'GRPK_CANDIDATE');

        if (selectable.length === 1) {
          setShowLocationPopup(false);
          onSave({ geom: postMessageGeom, data: selectable[0] });
          handleSuccess('Sėkmingai pasirinkta žuvinimo vieta');
        } else if (selectable.length === 0) {
          setCandidate(candidate ?? null);
          setLocations([]);
          onSave({ geom: null, data: null });
        } else {
          setCandidate(null);
          setLocations(selectable);
        }
```

and render, in place of the bare `'Nerastas telkinys'`:

```tsx
                  {locations.length === 0 ? (
                    candidate ? (
                      <CandidateBlock>
                        <Title>{candidate.name}</Title>
                        <Description>{locationTexts.grpkCandidate}</Description>
                        <PopupButton
                          onClick={async () => {
                            const [x, y] = geom.features[0].geometry.coordinates;
                            await api.requestPendingLocation({ x, y });
                            handleSuccess(locationTexts.requested);
                            setShowLocationPopup(false);
                            setCandidate(null);
                          }}
                        >
                          {locationTexts.requestButton}
                        </PopupButton>
                      </CandidateBlock>
                    ) : (
                      locationTexts.notFound
                    )
                  ) : (
                    locations.map(/* unchanged */)
                  )}
```

Declare `const [candidate, setCandidate] = useState<FishStockingLocation | null>(null);` alongside the existing state, and style `CandidateBlock` as a `styled.div` matching `Item`.

- [ ] **Step 4: Typecheck and lint**

Run: `yarn build && yarn lint`
Expected: both clean. `yarn build` runs `tsc`, so this is the typecheck.

- [ ] **Step 5: Verify live against the running app**

Start the API and the web app, open the registration form, click LKS94 `328452, 6133555` (Naikupė) and `329527, 6132126` (Šmulžiogis) on the map. Expected: the popup shows the name plus "Prašyti įtraukti telkinį", not "Nerastas telkinys". Confirm zero console errors and that the popup is reachable and operable by keyboard. This covers acceptance items A1 and A2.

- [ ] **Step 6: Commit**

```bash
git add src/components/other/RegistrationMap.tsx src/utils/api.ts src/utils/types.ts src/utils/texts.ts
git commit -m "zuvinimas: offer a GRPK water-body request when UETK has no object"
```

---

### Task 7: AAA approval screens (biip-admin-web)

**Files:**
- Create: `src/modules/zuvinimas/pages/PendingLocations.tsx`
- Create: `src/modules/zuvinimas/pages/PendingLocation.tsx`
- Modify: `src/modules/zuvinimas/api.ts`, `src/modules/zuvinimas/utils/router.tsx`, `src/modules/zuvinimas/utils/texts.ts`

**Interfaces:**
- Consumes: `pendingLocations` list/get plus `approve`, `reject`, `linkToUetk` from Task 3.
- Produces: no backend interface.

Mirror the existing mandatory-locations pair — `src/modules/zuvinimas/pages/Locations.tsx` (117 lines) and `LocationForm.tsx` (134 lines) — for table layout, `FormPageWrapper`, `useOnQueryError` and delete-confirmation conventions.

- [ ] **Step 1: Add the API methods**

```ts
// src/modules/zuvinimas/api.ts
  getPendingLocations = async ({ page, filter }: TableList): Promise<GetAllResponse<PendingLocation>> =>
    await this.get({ resource: 'pendingLocations', page, filter });

  getPendingLocation = async (id: string): Promise<PendingLocation> =>
    await this.getOne({ resource: 'pendingLocations', id });

  approvePendingLocation = async (id: string): Promise<PendingLocation> =>
    await this.post({ resource: `pendingLocations/${id}/approve` });

  rejectPendingLocation = async (id: string): Promise<PendingLocation> =>
    await this.post({ resource: `pendingLocations/${id}/reject` });

  linkPendingLocationToUetk = async (id: string, uetkCadastralId: string): Promise<PendingLocation> =>
    await this.post({ resource: `pendingLocations/${id}/linkToUetk`, params: { uetkCadastralId } });
```

- [ ] **Step 2: Add routes and copy**

```ts
// src/modules/zuvinimas/utils/router.tsx — inside `slugs`
  pendingLocations: '../nustatymai/neregistruoti-telkiniai',
  pendingLocation: (id: string) => `../nustatymai/neregistruoti-telkiniai/${id}`,
```

```ts
// src/modules/zuvinimas/utils/texts.ts — inside pageTitles
  pendingLocations: 'Neregistruoti telkiniai',
  pendingLocation: 'Neregistruotas telkinys',
```

Register both pages in the route table next to `Locations` / `LocationForm`.

- [ ] **Step 3: Build the list page**

```tsx
// src/modules/zuvinimas/pages/PendingLocations.tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import ListPageWrapper from '../../../components/wrappers/ListPageWrapper';
import Table from '../../../components/tables/Table';
import { useTableData } from '../../../utils/hooks';
import api from '../api';
import { slugs } from '../utils/router';
import { pageTitles } from '../utils/texts';

const labels = {
  name: { label: 'Pavadinimas', show: true },
  status: { label: 'Būsena', show: true },
  municipality: { label: 'Savivaldybė', show: true },
  cadastralId: { label: 'Rezervuotas ID', show: true },
  createdAt: { label: 'Pateikta', show: true },
};

const statusLabels: Record<string, string> = {
  REQUESTED: 'Laukia patvirtinimo',
  APPROVED: 'Patvirtintas',
  REJECTED: 'Atmestas',
  REGISTERED_IN_UETK: 'Įregistruotas UETK',
};

const PendingLocations = () => {
  const navigate = useNavigate();
  const { tableData, loading } = useTableData({
    name: 'pendingLocations',
    endpoint: (page) => api.getPendingLocations({ page }),
    mapData: (list) =>
      list.map((item) => ({
        id: item.id,
        name: item.name,
        status: statusLabels[item.status] ?? item.status,
        municipality: item.municipality?.name ?? '-',
        cadastralId: item.cadastralId ?? '-',
        createdAt: item.createdAt,
      })),
    dependency: [],
  });

  return (
    <ListPageWrapper title={pageTitles.pendingLocations}>
      <Table
        loading={loading}
        data={tableData}
        labels={labels}
        onClick={(id: string) => navigate(slugs.pendingLocation(id))}
      />
    </ListPageWrapper>
  );
};

export default PendingLocations;
```

Check the imports against `src/modules/zuvinimas/pages/Locations.tsx` before writing — that file is the authority for the wrapper, table and `useTableData` shapes in this repo, and the names above must match it exactly.

- [ ] **Step 4: Build the detail page with the duplicate-candidate panel**

`PendingLocation.tsx` shows the requested water body and — this is the part that actually prevents duplicates, so it is not optional — a "Galimi sutapimai" panel listing:
- other `pendingLocations` rows whose name matches case-insensitively (any status),
- UETK objects returned by `api.getLocations({ search: name })`.

Actions: **Patvirtinti** (`approve`), **Atmesti** (`reject`), and, for an approved row, a field for the real UETK cadastral id plus **Susieti su UETK** (`linkToUetk`). Every field goes through the repo's shared field components so labels and error wiring come for free.

- [ ] **Step 5: Typecheck, lint and verify live**

Run: `yarn build && yarn lint`
Then, in the running admin app: approve the Naikupė request, confirm `cadastralId` becomes `NR-000001`, then register a fish stocking on it in `biip-zuvinimas-web` end to end and confirm the point appears on the public map. This covers acceptance items A5 and A6.

- [ ] **Step 6: Commit**

```bash
git add src/modules/zuvinimas/pages/PendingLocations.tsx \
        src/modules/zuvinimas/pages/PendingLocation.tsx \
        src/modules/zuvinimas/api.ts src/modules/zuvinimas/utils/router.tsx \
        src/modules/zuvinimas/utils/texts.ts
git commit -m "zuvinimas: add AAA approval screens for unregistered water bodies"
```

---

### Task 8: record the decision in the repo

**Files:**
- Create: `docs/adr/0001-unregistered-water-bodies.md`
- Modify: `CONTEXT.md`

**Interfaces:** none.

The reserved-namespace choice and the "staging register, not a cadastre" boundary are hard to reverse once ids are in production data, so they belong in the repo where the whole team sees them — not only in the plan.

- [ ] **Step 1: Write the ADR**

`docs/adr/0001-unregistered-water-bodies.md` records: context (UETK gaps, the Rusnė case), the decision (staging register keyed by `NR-######`, spatial identity, AAA approval, `linkToUetk` exit), the rejected alternatives (`cadastral_id: null` collisions, GRPK `TOP_ID` fragmentation, name+municipality splitting long rivers) and the consequences (statistics gap until registration, dependency on a public geoportal.lt endpoint).

- [ ] **Step 2: Add the glossary entries to `CONTEXT.md`**

| Lithuanian | Canonical identifier | Meaning |
|---|---|---|
| neregistruotas telkinys | `pendingLocation` | Real water body absent from UETK, staged until registered |
| rezervuotas kadastro ID | `NR-######` | Temporary identifier minted on AAA approval |
| GRPK pasiūlymas | `GRPK_CANDIDATE` | Name + geometry proposed from GRPK, not yet selectable |

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0001-unregistered-water-bodies.md CONTEXT.md
git commit -m "zuvinimas: document the unregistered water body decision"
```

---

## Final verification

- [ ] `yarn lint && yarn build && yarn test` green in `biip-zuvinimas-api`.
- [ ] `yarn build && yarn lint` green in both frontends.
- [ ] Every acceptance item A1–A10 walked against the running system, with the result recorded.
- [ ] `migration-reviewer` agent run over `20260921120000_pendingLocations.js` before pushing — the API runs migrations on boot, so a bad migration restart-loops the container.
- [ ] Full audit pass: `Workflow({ scriptPath: '/home/lukas/.claude/workflows/full-audit.js', args: { base: 'main' } })`.
