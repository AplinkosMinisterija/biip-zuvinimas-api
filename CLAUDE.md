# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BIIP Žuvinimas API — Lithuanian government (Aplinkos Ministerija) fish-stocking management backend. Tracks planned fish stockings on water bodies, inspections by authorised users, and PII of inspectors / tenant companies. Two frontends consume this API:

- `biip-zuvinimas-web` — citizen / freelancer / tenant USER frontend (Vite + React)
- `biip-admin-web` — ADMIN frontend (module under `src/modules/zuvinimas/`)

When changing endpoint contracts, cross-check both frontends before declaring done.

## Stack

- Node 18 (engine pinned `>=18.0.0 <19.0.0` — `yarn build` refuses to run on Node 20; use `npx tsc --build` if you must check types on a newer Node)
- TypeScript 5.1
- [Moleculer 0.14](https://moleculer.services/) microservice broker, services as ES classes via `moleculer-decorators` (`@Service`, `@Action`, `@Method`, `@Event`)
- `moleculer-web` HTTP gateway
- `@moleculer/database` + `moleculer-knex-filters` + Objection + Knex over PostgreSQL (with PostGIS)
- Redis cacher (`zuvinimas:` prefix, 1h TTL)
- MinIO for fish-stocking photo uploads
- Auth: `biip-auth-nodejs` mixin → external `biip-auth-api` (evartai SSO). Bearer tokens in `Authorization` header, tenant context via `X-Profile` header.

## Common commands

```bash
yarn dc:up           # start postgres/redis/minio (compose project: biip-zuvinimas-api)
yarn dev             # migrate + run moleculer-runner in hot-reload + REPL mode
yarn db:migrate      # apply pending migrations from database/migrations/
yarn build           # tsc --build
yarn lint            # eslint .ts/.js
yarn test            # spins up local DB + jest (currently only test/example.spec.js stub)
yarn test -- <pattern>  # single test
yarn cli             # moleculer connect NATS REPL
```

Local services bind to: postgres `localhost:5449`, redis `localhost:6141`, minio `localhost:9140` (console 9141).

`db:migrate` runs automatically on `yarn dev` and `yarn start`. New migrations live in `database/migrations/<timestamp>_name.js` (raw `.js`, not TS).

## Architecture

### Authorization model (CRITICAL — read before touching any service)

`types/constants.ts` defines `RestrictionType`:

- `PUBLIC` — no auth
- `USER` — only `type === 'USER'` (not admins)
- `ADMIN` — only `ADMIN` / `SUPER_ADMIN`
- `DEFAULT` — **any authenticated user, including USER, ADMIN, SUPER_ADMIN**

`DEFAULT` means "any logged-in user", not "secure default". `api.service.ts:getRestrictionType` resolves auth via `req.$action.auth || req.$action.service?.settings?.auth || RestrictionType.DEFAULT`. **`auth:` must be inside the service's `settings:` block** — top-level `auth:` on the `@Service` decorator is silently ignored by the gateway (a real bug fixed in PR #93 for `settings.service.ts`; double-check when adding new services).

The gateway runs with `mappingPolicy: 'all'` + `whitelist: ['**']` + `autoAliases: true`. Every action is reachable as `POST /api/<service>/<action>` unless explicitly marked `visibility: 'protected'`. Internal-only actions (e.g. `fishBatches.*`) MUST be `protected` or they leak through the HTTP gateway.

### Request lifecycle

1. `api.service.ts:authenticate` runs for non-PUBLIC routes: validates Bearer, calls `auth.users.resolveToken`, loads local `users` row keyed by `authUser`.
2. If `X-Profile` header is set (and not `'freelancer'`), it is coerced to `Number` and validated against `tenantUsers` membership; the numeric tenant id is stored on `ctx.meta.profile`.
3. `api.service.ts:authorize` enforces `RestrictionType`. `DEFAULT` passes through with no extra check — scope/hook enforcement is each service's responsibility.
4. Service action runs. Most data-bearing services apply a `profile` scope (see below) and `filterTenant` / `beforeSelect` hooks for per-tenant data segregation.

### Tenant scoping pattern

`fishStockings.service.ts:scopes.profile` is the canonical model — implemented in Moleculer DSL (`$or`, `$in`, `$exists`), never raw SQL:

- **Admin** (`!ctx.meta.user && authUser.type in [ADMIN, SUPER_ADMIN]`) — filter by `authUser.municipalities` (from auth server). Empty municipalities → `NoMunicipalityPermission`.
- **Tenant USER** (`ctx.meta.profile && ctx.meta.user`) — `tenant === profile OR stockingCustomer === profile`.
- **Freelancer** (`!ctx.meta.profile && ctx.meta.user`) — `createdBy === user.id AND tenant NOT EXISTS`.

`users.service.ts:filterTenant` enforces the same segregation through `before:` hooks. `tenantUsers.service.ts:beforeSelect` + `validateTargetTenant` + `canManageTenantUsers` together gate cross-tenant access; admins bypass `validateTargetTenant` so they can manage any tenant.

### Raw SQL — `$raw` rules

`moleculer-knex-filters` accepts `query.$raw = { condition: string, bindings: any[] }`. **Always use `?` placeholders + bindings**, never string-interpolate user input. Reference implementations:

- `fishStockings.service.ts:beforeSelect` — multi-clause helper `appendRaw(clause, bindings)`
- `publishing.fishStockings.service.ts:getPublicItems` — `IN (...)` with placeholder-expansion
- `public.service.ts:getFilteredBatches` — jsonb containment via `?::jsonb` cast on `JSON.stringify`'d bindings

Cross-cutting filter values arrive on `ctx.params.filter` (often as a JSON string when sent via querystring) — always parse with `JSON.parse` defensively, coerce numerics via `Number(...) + Number.isFinite`, never trust raw strings into SQL.

### Service map

| Service | Notes |
|---------|-------|
| `api.service.ts` | Sole HTTP gateway. Path: `/zuvinimasnew`. Routes: `/ping`, `/uml`, `/api/openapi`, `/api/**`. Bearer + `X-Profile` parsed here. |
| `auth.service.ts` | Wraps `biip-auth-nodejs/mixin`. `login`/`evartai.login` PUBLIC; syncs `users`, `tenants`, `tenantUsers` from auth server after each login via `afterUserLoggedIn`. `users.updated`/`removed` / `tenantUsers.*` events propagate role changes back to auth (OWNER↔USER_ADMIN sync). |
| `users.service.ts` | Local mirror of auth users. `tenants` jsonb maps `{tenantId: role}` and is rebuilt by `tenantUsers.*` event handler via raw `tenants \|\| '{...}'::jsonb` (trusted DB-only data). |
| `tenantUsers.service.ts` | Tenant↔user join table. `update`/`remove` go through `canManageTenantUsers` (caller role in `ctx.meta.profile`) AND `validateTargetTenant` (target's tenant matches caller's profile, unless admin). |
| `tenants.service.ts` | Company records. `invite` mirrors invite into auth server. |
| `fishStockings.service.ts` | Core entity. Status (`UPCOMING`, `ONGOING`, `FINISHED`, `INSPECTED`, `NOT_FINISHED`, `CANCELED`) is a **virtual field** computed from `eventTime` + `batches.reviewAmount` + `settings.maxTimeForRegistration` + `signatures`. Filter UI maps statuses through `getStatusQueries(maxTime)` SQL templates. `register`/`updateRegistration`/`review`/`cancel` mutate by USER; `updateFishStocking` (PATCH `/:id`) and `remove` are ADMIN only. `canProfileModifyFishStocking` in `utils/functions.ts` is the per-action ownership gate. |
| `fishBatches.service.ts` | Per-stocking fish counts. All actions `visibility: 'protected'` — only callable via `ctx.call` from `fishStockings`. |
| `fishStockingPhotos.service.ts` | MinIO-backed photo upload (multipart, 5-file limit). `assertCanManageFishStocking` enforces tenant/freelancer/admin ownership on create+remove. |
| `fishStockingsCompleted.service.ts` / `publishing.fishStockings.service.ts` | Read-only views (`rest: false` on mixin) materialised by migration `20240404_completedFishstockingsView.js`. Used by public + statistics endpoints. |
| `public.service.ts` | PUBLIC unauthenticated read endpoints (`/public/fishStockings`, `/public/statistics`, `/public/uetk/statistics[/byYear]`). Cache-keyed; `public.**` cache cleared on any `fishStockings.*` event. **Any new param here MUST be validated/parameterized — no auth boundary.** |
| `locations.service.ts` | UETK water-body lookup (proxied to `process.env.INTERNAL_API`) + municipality WFS lookup (`process.env.GEO_SERVER`). All PUBLIC. |
| `mandatoryLocations.service.ts` | Seeded list of water bodies where review is mandatory. Filter values must use bindings. |
| `recentLocations.service.ts` | Per-user recent fish-stocking locations. `auth: USER`. |
| `settings.service.ts` | Global `minTimeTillFishStocking` / `maxTimeForRegistration`. `getSettings` is `DEFAULT` (USER needs it for registration flow), `updateSettings` is `ADMIN`. |
| `minio.service.ts` | Internal MinIO client wrapper. Don't expose new actions via REST. |
| `mail.service.ts` | Postmark wrapper. Only sends on `NODE_ENV in [production, staging]`. |
| `sentry.service.ts` | Sentry init from env. |

### Shared infrastructure

- `mixins/database.mixin.ts` — wraps `@moleculer/database` with knex adapter, common `findOne` action, and a `seedDB` hook that auto-runs when a table is empty on service start.
- `types/constants.ts` — `RestrictionType`, `COMMON_FIELDS` (createdBy/At, updatedBy/At, deletedBy/At), `COMMON_SCOPES.notDeleted` (default soft-delete scope), `FishOrigin`, `FishStockingStatus`, `StatusLabels`, `throwNoRightsError`.
- `types/moleculer.ts` — `UserAuthMeta` type augmentation, `MoleculerDBService<R>` typed base, `MultipartMeta`.
- `utils/functions.ts` — shared validators (`validateCanManageTenantUser`, `validateAssignedTo`, `validateFishOrigin`, `canProfileModifyFishStocking`) and status helpers (`isCanceled`, `isReviewed`, `isInspected`, `isOngoing`, `isUpcoming`, `isNotFinished`, `getStatus`).
- `modules/geometry.ts` — coordinate → GeoJSON helpers. PostGIS SRID 3346 (LKS-94, Lithuania).

### IDs

DbService fields with `secure: true` (e.g. `users.id`, `fishStockings.id`) are exposed as opaque strings via `encodeID`/`decodeID`. Foreign-key fields like `fishStockings.tenant` are typed as `Tenant['id']` (`string`) at the TS level but stored as integers in DB. When comparing FK values to runtime numbers (e.g. `ctx.meta.profile`), use `Number(value)` on both sides — Moleculer's query layer accepts either form for DB queries.

## Deployment

- `main` branch auto-deploys to **staging** via `.github/workflows/deploy-staging.yml`.
- GitHub **release** triggers **production** deploy (`deploy-production.yml`).
- `deploy-development.yml` is manual-dispatch for arbitrary branches.
- Healthcheck: `GET /zuvinimasnew/ping` (Dockerfile `HEALTHCHECK`).

## Conventions

- Prettier: `@aplinkosministerija/biip-prettier-config`. ESLint: `@aplinkosministerija/eslint-config-biip-api`. `lint-staged` + `husky` runs both on commit.
- Lithuanian is used freely in comments, error messages (`StatusLabels`, `FishStockingErrorMessages`), and excel column headers — keep it.
- Migrations: plain JS using Knex, file name `YYYYMMDDhhmmss_description.js`.
