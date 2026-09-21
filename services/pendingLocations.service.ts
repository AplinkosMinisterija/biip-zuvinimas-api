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
    // auto-generated create/update/remove actions would otherwise let any
    // caller write a row (or flip status to APPROVED) directly through the
    // HTTP gateway, bypassing all of that (mappingPolicy:'all' + autoAliases
    // expose every non-disabled action). list/find/get/count stay on so
    // USER/ADMIN can browse/track requests.
    DbConnection({ createActions: { create: false, update: false, remove: false } }),
    PostgisMixin({ srid: 3346 }),
  ],
  settings: {
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
      // natively for text[].
      grpkTopIds: { type: 'any', columnType: 'array' },
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
