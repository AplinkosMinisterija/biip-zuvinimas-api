'use strict';

import { Context } from 'moleculer';
import { GeomFeatureCollection, geomToWgs } from '../modules/geometry';

export function geomTransformFn(field: string) {
  return `ST_Transform(${field || 'geom'}, 3346)`;
}

export function geomAsGeoJsonFn(
  field: string = '',
  asField: string = 'geom',
  digits: number = 0,
  options: number = 0,
) {
  field = geomTransformFn(field);
  asField = asField ? ` as ${asField}` : '';
  return `ST_AsGeoJSON(${field}, ${digits}, ${options})::json${asField}`;
}

export function distanceFn(field1: string, field2: string) {
  const geom1 = geomTransformFn(field1);
  const geom2 = geomTransformFn(field2);
  return `ROUND(ST_Distance(${geom1}, ${geom2}))`;
}

export function areaFn(field: string) {
  return `ROUND(ST_Area(${geomTransformFn(field)}))`;
}

export function geomToFeatureCollection(geom: any, properties?: any) {
  const getFeature = (geom: any) => {
    return {
      type: 'Feature',
      geometry: geom,
      properties: properties || null,
    };
  };

  let geometries = [geom];
  if (geom.geometries?.length) {
    geometries = geom.geometries;
  }
  return {
    type: 'FeatureCollection',
    features: geometries.map((g: any) => getFeature(g)),
  };
}

export default {
  actions: {
    async getGeometryJson(
      ctx: Context<{
        id: number;
        field?: string;
        properties?: any;
      }>,
    ): Promise<GeomFeatureCollection> {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();

      const { id, field, properties } = ctx.params;
      const res = await table
        .select(table.client.raw(geomAsGeoJsonFn(field)))
        .where('id', id)
        .first();
      return geomToFeatureCollection(res.geom, properties);
    },
    async getWgsCoordinates(
      ctx: Context<{
        id: number;
        field?: string;
        properties?: any;
      }>,
    ): Promise<GeomFeatureCollection> {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();

      const { id, field, properties } = ctx.params;
      const res = await table
        .select(table.client.raw(geomAsGeoJsonFn(field)))
        .where('id', id)
        .first();
      const geom = geomToFeatureCollection(res.geom, properties);
      return geomToWgs(geom);
    },
  },
};
