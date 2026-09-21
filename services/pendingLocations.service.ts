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
  mixins: [
    // Mutation goes exclusively through request/approve/reject/linkToUetk —
    // each enforces its own transition + exclusion-constraint rules. The
    // auto-generated create/update/remove/createMany actions would otherwise
    // let any caller write a row (or flip status to APPROVED, or mint a
    // fabricated cadastralId) directly — over HTTP via autoAliases, or from
    // any other broker node with no gateway in the path at all. Disabling
    // them removes the action entirely rather than merely gating it.
    DbConnection({
      createActions: { create: false, update: false, remove: false, createMany: false },
    }),
    PostgisMixin({ srid: 3346 }),
  ],
  settings: {
    // Anything below that doesn't set its own per-action `auth` (list, find,
    // get, count, resolveAtPoint, proposeAtPoint) falls back to this —
    // ADMIN, not DEFAULT. Per-action `auth` wins over this (see
    // api.service.ts:getRestrictionType), so `request` stays USER and the
    // ADMIN actions are unaffected.
    auth: RestrictionType.ADMIN,
    fields: {
      id: { type: 'number', primaryKey: true, secure: true },
      name: 'string|required',
      cadastralId: 'string',
      uetkCadastralId: 'string',
      status: 'string',
      // `grpkTopIds` is a native Postgres text[] column (migration
      // 20260921120000), not jsonb. @moleculer/database's knex adapter has no
      // nested-field support, so any field typed 'array'/'object' gets
      // JSON.stringify'd before storage — correct for the jsonb `municipality`
      // field below, but it turns this into a malformed array literal against
      // a real text[] column. `type: 'any'` skips that serialization and lets
      // the plain JS array reach knex, which the pg driver serializes
      // natively for text[]. `type: 'any'` also skips fastest-validator's own
      // array check, so re-add it explicitly: the custom validator receives
      // `{ value, ... }` (@moleculer/database's `_callCustomFunction` calls it
      // with one object arg, not the bare value — confirmed against
      // moleculer-postgis's own `_geomValidateFn` and against
      // node_modules/@moleculer/database/src/validation.js:287-298).
      grpkTopIds: {
        type: 'any',
        columnType: 'array',
        validate: ({ value }: { value: unknown }) =>
          (Array.isArray(value) && value.every((v) => typeof v === 'string')) ||
          'grpkTopIds must be an array of strings',
      },
      grpkLayer: 'number',
      municipality: { type: 'object', columnType: 'json' },
      // GRPK often merges a river's area mapping and its centre-line mapping
      // into one cluster (see modules/grpk.ts mergeCluster) — that comes back
      // as a GeoJSON GeometryCollection with two features. `multi: true` tells
      // the mixin's field validator to allow more than one feature; without
      // it every two-layer cluster fails create with "Feature collection
      // accepts only one feature".
      geom: { type: 'any', geom: { type: 'geom', multi: true } },
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
    return this.createFromCluster(ctx, x, y, cluster, municipality);
  }

  @Action({
    rest: 'POST /:id/approve',
    auth: RestrictionType.ADMIN,
    params: { id: 'number|convert', confirmDistinct: 'boolean|optional|convert' },
  })
  async approve(
    ctx: Context<{ id: number; confirmDistinct?: boolean }>,
  ): Promise<PendingLocation> {
    const row: PendingLocation = await this.resolveEntities(
      ctx,
      { id: ctx.params.id },
      { throwIfNotExist: true },
    );
    if (row.status !== PendingLocationStatus.REQUESTED) {
      throw new moleculer.Errors.ValidationError('Only a REQUESTED location can be approved');
    }

    if (!ctx.params.confirmDistinct) {
      // Approve is where an identity is actually minted, so it is the last
      // point that can still catch this: the exclusion constraint only fires
      // on bounding-box overlap, so a same-name row far enough away (e.g. two
      // requests at opposite ends of a long watercourse GRPK/UETK doesn't
      // cover) passes it as two independent REQUESTED rows, and approving
      // both would mint two identities for one real water body. Two
      // genuinely distinct rivers sharing a name and sitting apart are legal
      // — the constraint deliberately allows them — so this is a confirmable
      // warning, not a hard block; confirmDistinct overrides it deliberately.
      const candidates = await this.findDuplicateNameCandidates(ctx, row.id, row.name);
      if (candidates.length) {
        throw new moleculer.Errors.MoleculerClientError(
          `Another live location named "${row.name}" already exists`,
          409,
          'DUPLICATE_NAME_CANDIDATES',
          { candidates },
        );
      }
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
    const row: PendingLocation = await this.resolveEntities(
      ctx,
      { id: ctx.params.id },
      { throwIfNotExist: true },
    );
    // Mirrors approve's guard: an already-APPROVED row has a minted
    // cadastralId in play (possibly already on live stockings). Rejecting it
    // would drop it out of the exclusion constraint's WHERE, letting the same
    // water body be requested again and minted a second identity.
    if (row.status !== PendingLocationStatus.REQUESTED) {
      throw new moleculer.Errors.ValidationError('Only a REQUESTED location can be rejected');
    }
    return this.updateEntity(ctx, {
      id: row.id,
      status: PendingLocationStatus.REJECTED,
    });
  }

  /**
   * The exit path: AAA registered the object in UETK. This service only
   * retires its own row and announces the fact — it never reaches into
   * fish_stockings directly. biip-zvejyba-api has its own database and could
   * never be reached by an in-service UPDATE here, so every consumer
   * (fishStockings included) rewrites its own table from the
   * `pendingLocations.registeredInUetk` event instead.
   */
  @Action({
    rest: 'POST /:id/linkToUetk',
    auth: RestrictionType.ADMIN,
    params: { id: 'number|convert', uetkCadastralId: 'string' },
  })
  async linkToUetk(
    ctx: Context<{ id: number; uetkCadastralId: string }>,
  ): Promise<PendingLocation> {
    const row: PendingLocation = await this.resolveEntities(
      ctx,
      { id: ctx.params.id },
      { throwIfNotExist: true },
    );
    if (!row.cadastralId) {
      throw new moleculer.Errors.ValidationError('Location has no reserved cadastral id');
    }
    const { uetkCadastralId } = ctx.params;

    // Calling this again with the SAME id is the documented recovery path
    // when the earlier emit failed to reach a consumer — allow it through
    // unchanged, re-emitting below as usual. A DIFFERENT id (an admin
    // correcting a clerical error) is not safe to allow: the event below
    // uses `row.cadastralId` (the reserved NR- id) as its match key, but the
    // first call's fishStockings handler already rewrote every row away from
    // that key. A second rewrite would therefore silently match nothing,
    // leaving fish_stockings on the wrong UETK id while this row shows the
    // corrected one. Refuse rather than corrupt that silently — a genuine
    // correction needs its own path, not a second linkToUetk call.
    if (
      row.status === PendingLocationStatus.REGISTERED_IN_UETK &&
      row.uetkCadastralId !== uetkCadastralId
    ) {
      throw new moleculer.Errors.ValidationError(
        `Location is already registered in UETK as ${row.uetkCadastralId}; correcting to ${uetkCadastralId} is not supported through this action`,
      );
    }

    const updatedRow: PendingLocation = await this.updateEntity(ctx, {
      id: row.id,
      uetkCadastralId,
      status: PendingLocationStatus.REGISTERED_IN_UETK,
    });

    // Fire-and-forget by design: a real second consumer (biip-zvejyba-api) is
    // a separate service reached over the broker's transporter, and this
    // action must not block its own response on a remote handler completing.
    // Local handlers (fishStockings, in this repo) still run to completion,
    // just not before this promise resolves — callers that depend on the
    // side effect must poll.
    ctx
      .emit('pendingLocations.registeredInUetk', {
        reservedCadastralId: row.cadastralId,
        uetkCadastralId,
      })
      .catch((err: Error) =>
        this.logger.error('Failed to emit pendingLocations.registeredInUetk', err),
      );

    return updatedRow;
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

  /**
   * Other live (REQUESTED/APPROVED, not deleted) rows sharing this row's
   * name, compared case-insensitively. Used by `approve` — see the guard
   * there for why proximity/geometry checks can't cover this case.
   */
  async findDuplicateNameCandidates(
    ctx: Context,
    id: number,
    name: string,
  ): Promise<Array<{ id: number; name: string; status: PendingLocationStatus }>> {
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    const { rows } = await knex.raw(
      `SELECT id, name, status FROM pending_locations
        WHERE deleted_at IS NULL
          AND status = ANY(?)
          AND id != ?
          AND lower(name) = lower(?)`,
      [[PendingLocationStatus.REQUESTED, PendingLocationStatus.APPROVED], id, name],
    );
    return rows;
  }

  async createFromCluster(
    ctx: Context,
    x: number,
    y: number,
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
      // overlapping cluster). Matching by name alone is not enough — the
      // constraint deliberately allows two distinct same-name rivers that
      // don't overlap, so a plain `find({name})` can hand back the WRONG
      // one's row, or a REJECTED/REGISTERED_IN_UETK row as if it were live.
      // Re-run the same point-proximity lookup `request` already trusts
      // instead: it's scoped to this exact point AND to live statuses.
      const pgErr = err as { code?: string; constraint?: string };
      const isOverlapViolation =
        pgErr.code === '23P01' || pgErr.constraint === 'pending_locations_no_overlap';
      if (isOverlapViolation) {
        const existing = await this.findRowAtPoint(ctx, x, y, [
          PendingLocationStatus.REQUESTED,
          PendingLocationStatus.APPROVED,
        ]);
        if (existing) return existing;
      }
      // Either a different failure entirely, or a genuine anomaly — an
      // overlap violation with no live row at this exact point. Don't
      // swallow it.
      throw err;
    }
  }
}
