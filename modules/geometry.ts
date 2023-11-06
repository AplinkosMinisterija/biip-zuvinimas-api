// @ts-ignore
import transformation from 'transform-coordinates';
export type CoordinatesPoint = number[];
export type CoordinatesLine = CoordinatesPoint[];
export type CoordinatesPolygon = CoordinatesLine[];
export type CoordinatesMultiPolygon = CoordinatesPolygon[];
export type GeometryObject = {
  type: string;
  coordinates: CoordinatesPoint | CoordinatesLine | CoordinatesPolygon | CoordinatesMultiPolygon;
};

export type GeomFeatureCollection = {
  type: string;
  features: GeomFeature[];
};

export type GeomFeature = {
  type: string;
  properties?: any;
  geometry: GeometryObject;
};

export const GeometryType = {
  POINT: 'Point',
  MULTI_POINT: 'MultiPoint',
  LINE: 'LineString',
  MULTI_LINE: 'MultiLineString',
  POLYGON: 'Polygon',
  MULTI_POLYGON: 'MultiPolygon',
};

export function geometryToGeom(geometry: GeometryObject) {
  return `ST_AsText(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'))`;
}

export function geometriesToGeomCollection(geometries: GeometryObject[]) {
  return `ST_AsText(ST_Collect(ARRAY(
    SELECT ST_GeomFromGeoJSON(JSON_ARRAY_ELEMENTS('${JSON.stringify(geometries)}'))
  )))`;
}

export function coordinatesToGeometry(coordinates: { x: number; y: number }) {
  const transform = transformation('EPSG:4326', '3346');
  const transformed = transform.forward(coordinates);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [transformed.x, transformed.y],
        },
      },
    ],
  };
}

export function geomToWgs(geom: GeomFeatureCollection) {
  const lks = geom.features[0].geometry.coordinates as CoordinatesPoint;
  const transform = transformation('3346', 'EPSG:4326');
  const coordinates = { x: lks[0], y: lks[1] };
  return transform.forward(coordinates);
}
