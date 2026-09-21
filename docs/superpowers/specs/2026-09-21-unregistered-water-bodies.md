# Spec: fish stocking on water bodies that are not in UETK

Date: 2026-09-21
Status: approved for implementation

## Problem

Fish stocking registration can only be done on a water body that exists in
UETK. Real water bodies exist that UETK has never registered, and people want
to stock fish in them.

Concrete trigger (Rusnė seniūnija, Šilutės r. sav., Nemunas delta):

| Water body | LKS94 point | In UETK? | In GRPK? |
|---|---|---|---|
| Naikupė (river) | 328452, 6133555 | no | yes — `HIDRO_L`, `GKODAS=hc1`, 23 segments, ~2.9 km |
| Šmulžiogis (lake) | 329527, 6132126 | no | yes — `PLOTAI_1`, `GKODAS=hd1`, 2 polygons, 6.1 ha |

Verified 2026-09-21 against the whole UETK register (12 068 objects,
`uetk.biip.lt/api/objects`): substring searches `aikup` and `mulžiog` return 0
rows nationally. The AAA ArcGIS mirror
(`dts.aplinka.lt/.../UETK_vandens_objektai`) agrees. Geometric check of all 214
UETK objects in Šilutės r. sav.: neither point falls on a registered object
(nearest to the river point: Pakalnė `10012669`, 671 m; nearest to the lake
point: Skatulė `10012668`, 100 m).

## Where it breaks today

```
FE map click
  → locations.search?geom=            services/locations.service.ts:162
  → getRiverOrLakeFromPoint           services/locations.service.ts:253
  → QGIS WFS project uetk_zuvinimas, TYPENAME=rivers | lakes_ponds
      (= uetk.upes_l / uetk.ezerai_tvenkiniai — UETK only)   :257, :265
  → 0 features
  → RegistrationMap.tsx:60  onSave({ geom: null, data: null })
  → RegistrationMap.tsx:129 "Nerastas telkinys"
```

Both layers block submission:

- FE: `biip-zuvinimas-web/src/utils/validations.ts:51,91` — `location` required.
- BE: `services/fishStockings.service.ts:727` — `POST /register` requires
  `location.cadastral_id: 'string'` (not optional).

## What does and does not depend on the cadastral id

`location` is a plain JSONB column — there is no `locations` table and no
foreign key (`database/migrations/20230502151722_locations.js` dropped and
recreated it as `jsonb`). Water-body identity is therefore
`location->>'cadastral_id'` everywhere:

| Consumer | Key |
|---|---|
| `recent_locations` view | `DISTINCT ON (location->>'cadastral_id', created_by, tenant_id)` |
| `fishStockings.getLocationsCount` (`:1098`) | `distinct location->>'cadastral_id'` |
| `public.service.ts:255-281` UETK statistics | grouped by `cadastral_id` |
| mandatory-location match (`fishStockings.service.ts:399`) | `ml.location.cadastral_id === entity.location.cadastral_id` |

The **public map does not**: it renders `publishing.fishStockings.geom` (a
point, SRID 3346) as vector tiles
(`biip-maps-web/src/utils/layers/vector-tiles.ts:118`). A stocking on a
non-UETK water body displays correctly with no map change.

## Why the two obvious approaches are wrong

**`cadastral_id: null`** does not produce duplicates — it produces *collisions*.
`DISTINCT ON (null, user, tenant)` collapses every unregistered water body of
one user into a single "recent location", and statistics lump them all under one
`null` key. Silent data merging is worse than a duplicate.

**GRPK `TOP_ID` as the key** produces *fragmentation*. GRPK stores Naikupė as 23
separate features with 23 different `TOP_ID`s and Šmulžiogis as 2 polygons; two
stockings 500 m apart on the same river would get different identities. GRPK's
stable key column `GRAKTAS` is NULL for both objects, so it cannot be used
either. Name alone is not unique — 13 further `Naikupė` segments exist elsewhere
in Lithuania.

**Name + municipality** is also wrong: a long river crosses many
municipalities, so the same river would get one row per municipality.
Municipality is a property of the *stocking point*, not of the water body, and
it already is one (`getMunicipalityFromPoint`).

## Decisions

1. **The real fix is UETK registration.** AAA is the UETK manager and
   `uetk.biip.lt/app/duomenu-teikimas` is the e-service for it. Once an object
   is in UETK, no code path changes. Everything below is the bridge, and it has
   an explicit exit.

2. **One row per real-world water body** in a new `pendingLocations` table.
   GRPK is a *source of a proposal* (name + geometry), never the identity.

3. **Identity is spatial, not nominal.** The row stores the merged geometry of
   the connected same-name GRPK cluster, so a click anywhere along the object
   resolves to the same row. A declarative backstop prevents a second
   overlapping row of the same name:

   ```sql
   EXCLUDE USING gist (lower(name) WITH =, geom WITH &&)
     WHERE (status IN ('REQUESTED', 'APPROVED'))
   ```

   Two genuinely different `Naikupė` rivers (non-overlapping bboxes) remain
   legal; a second `Nemunas` row does not.

4. **`cadastral_id` stays a non-null string**, drawn from a reserved namespace
   `NR-<6 digits>`. Real UETK cadastral ids always start with a digit, so the
   namespace cannot collide. Every existing `cadastral_id`-keyed consumer keeps
   working unchanged — no null handling anywhere.

5. **AAA approves before a water body becomes selectable.** The user's map click
   creates a *request*; an AAA administrator approves it in `biip-admin-web`.
   This, not a database constraint, is the real duplicate prevention — the
   approval screen shows nearby and same-name candidates.

6. **UETK-facing endpoints exclude the `NR-` namespace.**
   `/public/uetk/statistics` and `/public/uetk/statistics/byYear` filter out
   `cadastral_id LIKE 'NR-%'`, so the UETK portal is never polluted with
   identifiers UETK does not own.

7. **Exit path is a service action, not a manual migration.** When AAA registers
   the object in UETK, `pendingLocations.linkToUetk` writes the real cadastral id
   onto every affected stocking in one transaction and retires the row.

8. **The register is hosted in `biip-zuvinimas-api` but designed as shared.**
   `biip-zvejyba-api` has the same model — `fishings.uetkCadastralId` is a
   plain string resolved against `${INTERNAL_API}/uetk/objects`
   (`services/fishings.service.ts:74,182`, `services/location.service.ts:120-154`),
   with no foreign key — so it has the same gap and an `NR-` id works there
   unchanged. `biip-uetk-api` would be the natural host since both apps
   already call it, but UETK is being transferred to another institution in
   full, and a BĮIP-side staging queue must not travel with it. Therefore the
   table lives here, and the constraints that keep it movable are binding:
   no žuvinimas-specific column or field, REST under `/pendingLocations`, and
   ids that mean the same thing to any consumer. `biip-zvejyba-api` consumes
   it over `INTERNAL_API` the same way it already consumes UETK. Moving the
   table to a neutral host later is then one table plus one service, with no
   id migration.

## Non-goals

- No second cadastre. `pendingLocations` is a staging queue with a documented
  exit, not a parallel register. It must not grow attributes UETK owns.
- No change to the public map.
- No bulk import of GRPK into the BĮIP database. GRPK is queried live at
  `https://www.geoportal.lt/mapproxy/gisc_grpk/MapServer` (public ArcGIS REST,
  layer 19 = water bodies, layer 20 = watercourse centre lines), which is
  already used in `biip-maps-web` as a raster basemap.

## Acceptance criteria

1. Clicking the Naikupė point (LKS94 328452, 6133555) on the registration map
   offers "Naikupė" as a GRPK candidate instead of "Nerastas telkinys".
2. Clicking the Šmulžiogis point (329527, 6132126) offers "Šmulžiogis".
3. Submitting the request creates one `pendingLocations` row with
   `status=REQUESTED` and the merged GRPK geometry.
4. A second click 500 m away along the same river reuses that row — it does not
   create a second one.
5. After AAA approves, the water body is selectable and a fish stocking can be
   registered on it end to end.
6. The registered stocking appears on the public map at the clicked point.
7. `recent_locations`, `getLocationsCount` and municipality filtering treat the
   two water bodies as two distinct objects.
8. `/public/uetk/statistics` contains no `NR-` keys.
9. `pendingLocations.linkToUetk` rewrites every affected stocking's
   `cadastral_id` to the real UETK id, and afterwards the object resolves
   through the normal UETK path.
