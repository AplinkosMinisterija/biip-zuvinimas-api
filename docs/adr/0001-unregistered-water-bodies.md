# ADR 0001: Staging register for water bodies absent from UETK

**Date:** 2026-09-21  
**Status:** Approved  
**Deciders:** BIIP team  

## Context

Lithuania's UETK (Unified Water Objects Register) maintained by the Environment Protection Agency does not contain every real water body. On 2026-09-21, a substring search of the complete national register (12,068 objects) confirmed that the river Naikupė and the lake Šmulžiogis, both in the Nemunas delta (Rusnės seniūnija), are absent, while both exist in the national GRPK (Topographic Database) dataset. Geometric verification: the points LKS94 (328452, 6133555) for Naikupė and (329527, 6132126) for Šmulžiogis fall on zero UETK objects in Šilutės municipality.

Fish stocking registration requires a UETK cadastral id. Users cannot register intended stockings on these real water bodies because they have no identifier.

## Decision

1. A staging register (`pendingLocations`), one row per real-world water body, temporarily bridges the gap until UETK registration occurs.

2. GRPK is a **source of a proposal** (name and geometry), never the identity. The row stores the merged geometry of the connected same-name GRPK cluster, so a click anywhere along the object resolves to the same row.

3. **Identity is spatial, not nominal.** A non-deferrable PostgreSQL exclusion constraint rejects a second live row of the same name whose bounding box overlaps an existing one:
   ```sql
   EXCLUDE USING gist (lower(name) WITH =, geom WITH &&)
     WHERE (status IN ('REQUESTED', 'APPROVED'))
   ```
   This allows two genuinely different same-name rivers (non-overlapping bboxes) to coexist; a duplicate request on the same river is caught by point-proximity lookup, not by name alone.

4. **`cadastral_id` remains non-null**, drawn from a reserved namespace `NR-######` (six zero-padded digits). Real UETK cadastral ids always start with a digit, so this namespace cannot collide. Every existing consumer keyed on `cadastral_id` continues unchanged — no null handling anywhere.

5. **Administrator approval is the gate.** A user's map click creates a `REQUESTED` row; an AAA administrator approves it in `biip-admin-web`, which mints the reserved id. This, not the database constraint alone, is the real duplicate prevention — the approval screen shows nearby and same-name candidates.

6. **UETK-facing endpoints exclude the `NR-` namespace.** `/public/uetk/statistics` and `/public/uetk/statistics/byYear` filter out `cadastral_id LIKE 'NR-%'`, so the UETK portal receives no identifiers UETK does not own.

7. **The exit path is a service action.** When AAA registers the object in UETK, `pendingLocations.linkToUetk` writes the real cadastral id onto every affected stocking in one transaction and retires the row. An event (`pendingLocations.registeredInUetk`) is emitted for cross-service consumers.

8. **The register is hosted in `biip-zuvinimas-api` but designed as shared.** `biip-zvejyba-api` has the same model — `fishings.uetkCadastralId` is a plain string resolved against the internal API, with no foreign key. It has the same gap and will consume this register unchanged. `biip-uetk-api` would be the natural host since both apps already call it, but UETK is being transferred to another institution in full, and a BIIP-side staging queue must not travel with it. Therefore the table lives here, and constraints keep it portable: no žuvinimas-specific column, field, or assumption; REST surface under `/pendingLocations`; and reserved ids that mean the same to any consumer.

## Alternatives Considered

### `cadastral_id: null`
Produces collisions, not duplicates. The `recent_locations` view uses `DISTINCT ON (location->>'cadastral_id', ...)`, so every unregistered water body of one user would collapse into a single row. Statistics would lump all null-keyed stockings under one null key. Silent data merging is worse than a duplicate.

### GRPK `TOP_ID` as the key
Fragmentation. GRPK stores Naikupė as 23 separate features with distinct `TOP_ID`s and Šmulžiogis as 2 polygons. Two stockings 500 m apart on the same river would get different identities. GRPK's stable key column `GRAKTAS` is null for both objects, so it cannot be used either.

### Name + municipality as the key
Wrong scope. A long river crosses many municipalities, so the same river would get one row per municipality. Municipality is a property of the *stocking point*, not of the water body, and it already is one (`getMunicipalityFromPoint`).

## Consequences

1. **Statistics for a staged water body are keyed by an id UETK does not own.** The `NR-` namespace is deliberately filtered out of all UETK-facing endpoints. This creates a temporary statistical blind spot until registration occurs.

2. **The system depends on a public geoportal.lt ArcGIS endpoint at request time.** GRPK queries are live against `https://www.geoportal.lt/mapproxy/gisc_grpk/MapServer`. Service availability is beyond BIIP's control.

3. **The stocking rewrite on UETK registration is eventually consistent, not transactional.** `linkToUetk` updates `fish_stockings` and fires an event; `biip-zvejyba-api` consumes the event asynchronously. There is a window where the two services see different data.

4. **The exclusion constraint guards only `REQUESTED` and `APPROVED` rows.** A row already retired to `REGISTERED_IN_UETK` no longer blocks a duplicate at the database level. The guard against re-requesting an already-registered object lives in application code (`ALREADY_IN_UETK` error, 409 Conflict).
