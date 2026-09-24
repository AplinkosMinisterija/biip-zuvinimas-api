'use strict';
import { describe, expect, it } from '@jest/globals';
import { GrpkLayer, esriToGeoJson, mergeCluster, GRPK_MAP_SERVER } from '../../modules/grpk';

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
    if (geom.type === 'MultiPolygon') {
      expect(geom.coordinates).toHaveLength(1);
      expect(geom.coordinates[0]).toHaveLength(2);
    }
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

  it('assigns a hole to its containing outer ring even when the hole comes first in the rings array', () => {
    // Rings[0] is a hole (counter-clockwise), rings[1] is outer ring (clockwise)
    // This tests that point-in-polygon assigns the hole to the correct outer ring
    const geom = esriToGeoJson('esriGeometryPolygon', {
      rings: [
        // Hole with counter-clockwise winding (positive shoelace)
        [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
        // Outer ring with clockwise winding (negative shoelace)
        [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
      ],
    });
    expect(geom.type).toBe('MultiPolygon');
    if (geom.type === 'MultiPolygon') {
      // Should be one polygon with two rings (outer + hole)
      expect(geom.coordinates).toHaveLength(1);
      expect(geom.coordinates[0]).toHaveLength(2);
      // First ring is the outer ring, second is the hole
      expect(geom.coordinates[0][0]).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]);
      expect(geom.coordinates[0][1]).toEqual([[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]);
    }
  });
});

describe('query error handling', () => {
  it('throws when the API returns a valid-JSON error body instead of treating it as empty results', async () => {
    // Mock fetch to return a valid JSON error response
    const originalFetch = global.fetch;
    const mockFetch = jest.fn();
    (global as unknown as { fetch: typeof global.fetch }).fetch = mockFetch as unknown as typeof global.fetch;

    mockFetch.mockResolvedValueOnce({
      text: jest.fn().mockResolvedValueOnce(JSON.stringify({
        error: {
          code: 400,
          message: 'Invalid query parameter',
        },
      })),
    } as unknown as Response);

    try {
      // Import the function that uses query internally so we can test it
      const { findClusterAtPoint } = await import('../../modules/grpk');
      await expect(findClusterAtPoint(328452, 6133555)).rejects.toThrow(/GRPK error/);
    } finally {
      (global as unknown as { fetch: typeof global.fetch }).fetch = originalFetch;
    }
  });
});

describe('mergeCluster', () => {
  it('merges every same-name feature into one geometry and keeps all TOP_IDs', () => {
    const featuresPerLayer = new Map(
      [[
        GrpkLayer.WATERCOURSES,
        [
          { attributes: { TOP_ID: 'a', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[0, 0], [1, 1]]] } },
          { attributes: { TOP_ID: 'b', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[1, 1], [2, 2]]] } },
        ],
      ]]
    );
    const cluster = mergeCluster('Naikupė', featuresPerLayer);
    expect(cluster.topIds).toEqual(['a', 'b']);
    expect(cluster.layers).toEqual([GrpkLayer.WATERCOURSES]);
    expect(cluster.primaryLayer).toBe(GrpkLayer.WATERCOURSES);
    expect(cluster.geom.type).toBe('MultiLineString');
    if (cluster.geom.type === 'MultiLineString') {
      expect(cluster.geom.coordinates).toHaveLength(2);
    }
  });

  it('produces a GeometryCollection with both geometries and union of TOP_IDs when both layers contribute', () => {
    const featuresPerLayer = new Map([
      [
        GrpkLayer.WATER_BODIES,
        [{ attributes: { TOP_ID: 'water1', VARDAS: 'Naikupė', GKODAS: 'hd1' }, geometry: { rings: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] } }],
      ],
      [
        GrpkLayer.WATERCOURSES,
        [
          { attributes: { TOP_ID: 'course1', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[0, 0], [1, 1]]] } },
          { attributes: { TOP_ID: 'course2', VARDAS: 'Naikupė', GKODAS: 'hc1' }, geometry: { paths: [[[1, 1], [2, 2]]] } },
        ],
      ],
    ]);
    const cluster = mergeCluster('Naikupė', featuresPerLayer);
    expect(cluster.topIds).toEqual(['water1', 'course1', 'course2']);
    expect(cluster.layers).toEqual([GrpkLayer.WATER_BODIES, GrpkLayer.WATERCOURSES]);
    expect(cluster.primaryLayer).toBe(GrpkLayer.WATERCOURSES);
    expect(cluster.geom.type).toBe('GeometryCollection');
    if (cluster.geom.type === 'GeometryCollection') {
      expect(cluster.geom.geometries).toHaveLength(2);
      expect(cluster.geom.geometries[0].type).toBe('MultiPolygon');
      expect(cluster.geom.geometries[1].type).toBe('MultiLineString');
    }
  });
});
