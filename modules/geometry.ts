// @ts-ignore
import transformation from 'transform-coordinates';

export type CoordinatesPoint = number[];
export type GeometryObject = {
  type: string;
  coordinates: CoordinatesPoint;
};
export type Coordinates = { x: number; y: number };

export type GeomFeatureCollection = {
  type: string;
  features: GeomFeature[];
};

export type GeomFeature = {
  type: string;
  properties?: any;
  geometry: GeometryObject;
};

export function geometryToGeom(geometry: GeometryObject) {
  return `ST_AsText(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'))`;
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

export function wgsToLks(coordinates: Coordinates) {
  const transform = transformation('EPSG:4326', '3346');
  return transform.forward(coordinates);
}

export function coordinatesToGeometry(coordinates: Coordinates): GeomFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [coordinates.x, coordinates.y],
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
