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
export type GeometryCollectionGeoJson = {
  type: 'GeometryCollection';
  geometries: (MultiPolygonGeoJson | MultiLineStringGeoJson)[];
};
export type GrpkGeometry = MultiPolygonGeoJson | MultiLineStringGeoJson | GeometryCollectionGeoJson;

export type GrpkCluster = {
  name: string;
  layers: GrpkLayer[];
  primaryLayer: GrpkLayer;
  topIds: string[];
  geom: GrpkGeometry;
};

// Shoelace: ArcGIS draws outer rings clockwise (negative area) and holes
// counter-clockwise. The Esri spec guarantees ring orientation but NOT ordering,
// so we must assign each hole to its containing outer ring, not assume adjacency.
const isOuterRing = (ring: Ring): boolean => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum < 0;
};

// Ray casting point-in-polygon test: returns true if point is inside the ring.
const pointInRing = (point: number[], ring: Ring): boolean => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

export function esriToGeoJson(geometryType: string, geometry: EsriGeometry): GrpkGeometry {
  if (geometryType === 'esriGeometryPolyline') {
    return { type: 'MultiLineString', coordinates: geometry.paths || [] };
  }

  const rings = geometry.rings || [];
  if (rings.length === 0) {
    return { type: 'MultiPolygon', coordinates: [] };
  }

  // Separate outer rings from holes
  const outerRings: Ring[] = [];
  const holes: Ring[] = [];
  for (const ring of rings) {
    if (isOuterRing(ring)) {
      outerRings.push(ring);
    } else {
      holes.push(ring);
    }
  }

  // If no outer rings found, treat all rings as outer (data error, but don't lose them)
  if (outerRings.length === 0) {
    return { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
  }

  // Assign each hole to the outer ring that contains it
  const polygons: Ring[][] = outerRings.map((r) => [r]);
  for (const hole of holes) {
    // Use the hole's first point to test containment
    const testPoint = hole[0];
    let assigned = false;
    for (let i = 0; i < outerRings.length; i++) {
      if (pointInRing(testPoint, outerRings[i])) {
        polygons[i].push(hole);
        assigned = true;
        break;
      }
    }
    // Data error: hole doesn't match any outer ring. Drop it and continue.
    if (!assigned) {
      // Silently drop holes with no containing outer ring; they are data anomalies
    }
  }

  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Merge features from one or more layers into a single cluster.
 * When both layers contribute, returns a GeometryCollection with both geometries.
 * When only one layer contributes, returns a homogeneous MultiPolygon or MultiLineString.
 *
 * Signature: `mergeCluster(name, featuresPerLayer)`
 * - featuresPerLayer: Map<GrpkLayer, EsriFeature[]> — each layer's features
 */
export function mergeCluster(
  name: string,
  featuresPerLayer: Map<GrpkLayer, EsriFeature[]>,
): GrpkCluster {
  const layers: GrpkLayer[] = [];
  const geometries: (MultiPolygonGeoJson | MultiLineStringGeoJson)[] = [];
  const allTopIds: string[] = [];

  // Process each layer in ascending order (WATER_BODIES first, then WATERCOURSES)
  for (const layer of [GrpkLayer.WATER_BODIES, GrpkLayer.WATERCOURSES]) {
    const features = featuresPerLayer.get(layer);
    if (!features || features.length === 0) continue;

    layers.push(layer);
    allTopIds.push(...features.map((f) => f.attributes.TOP_ID));

    const geometryType =
      layer === GrpkLayer.WATERCOURSES ? 'esriGeometryPolyline' : 'esriGeometryPolygon';
    const parts = features.map((f) => esriToGeoJson(geometryType, f.geometry));

    if (layer === GrpkLayer.WATERCOURSES) {
      // Merge all MultiLineString coordinates
      const coordinates: Ring[] = [];
      for (const part of parts) {
        if (part.type === 'MultiLineString') {
          coordinates.push(...part.coordinates);
        }
      }
      geometries.push({ type: 'MultiLineString', coordinates });
    } else {
      // Merge all MultiPolygon coordinates
      const coordinates: Ring[][] = [];
      for (const part of parts) {
        if (part.type === 'MultiPolygon') {
          coordinates.push(...part.coordinates);
        }
      }
      geometries.push({ type: 'MultiPolygon', coordinates });
    }
  }

  // Determine primary layer: WATERCOURSES if it contributed, else WATER_BODIES
  const primaryLayer =
    layers.includes(GrpkLayer.WATERCOURSES) ? GrpkLayer.WATERCOURSES : GrpkLayer.WATER_BODIES;

  const geom: GrpkGeometry =
    geometries.length === 2
      ? { type: 'GeometryCollection', geometries }
      : geometries[0] || { type: 'MultiPolygon', coordinates: [] };

  return {
    name,
    layers,
    primaryLayer,
    topIds: allTopIds,
    geom,
  };
}

function isGrpkResult(value: unknown): value is { geometryType?: string; features?: EsriFeature[] } {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // A valid result has either features array or geometryType, but not an error key
  if (obj.error !== undefined) return false;
  return obj.features === undefined || Array.isArray(obj.features);
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain-text error or invalid JSON
    throw new Error(`GRPK query failed for layer ${layer}: ${text.slice(0, 120)}`);
  }

  // Validate the parsed JSON is a result, not an error
  if (!isGrpkResult(parsed)) {
    const errorObj = parsed as Record<string, unknown>;
    if (errorObj.error && typeof errorObj.error === 'object') {
      const err = errorObj.error as Record<string, unknown>;
      throw new Error(
        `GRPK error for layer ${layer}: ${err.code || 'unknown'} - ${err.message || 'no message'}`
      );
    }
    throw new Error(`GRPK query returned unexpected shape for layer ${layer}`);
  }

  return parsed;
}

/**
 * Find the named GRPK water feature at a point, then return its whole
 * same-name cluster from BOTH layers. `radiusMeters` bounds the cluster query
 * — a click far along a very long object can therefore produce a partial
 * cluster; the pendingLocations overlap constraint merges those cases instead
 * of duplicating them.
 */
export async function findClusterAtPoint(
  x: number,
  y: number,
  toleranceMeters = 25,
  radiusMeters = 11000,
): Promise<GrpkCluster | null> {
  const point = JSON.stringify({ x, y, spatialReference: { wkid: 3346 } });

  // Find a named hit in any layer
  let name: string | null = null;
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
    if (named) {
      name = named.attributes.VARDAS as string;
      break;
    }
  }

  if (!name) return null;

  // Query both layers for all same-name features in the envelope
  const envelope = JSON.stringify({
    xmin: x - radiusMeters,
    ymin: y - radiusMeters,
    xmax: x + radiusMeters,
    ymax: y + radiusMeters,
    spatialReference: { wkid: 3346 },
  });

  const featuresPerLayer = new Map<GrpkLayer, EsriFeature[]>();
  for (const layer of [GrpkLayer.WATER_BODIES, GrpkLayer.WATERCOURSES]) {
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
    if (cluster.features && cluster.features.length > 0) {
      featuresPerLayer.set(layer, cluster.features);
    }
  }

  // If no features found in either layer, return null
  if (featuresPerLayer.size === 0) return null;

  return mergeCluster(name, featuresPerLayer);
}
