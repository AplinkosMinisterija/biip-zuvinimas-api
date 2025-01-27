'use strict';

import { find, map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { GeomFeatureCollection, coordinatesToGeometry } from '../modules/geometry';
import { RestrictionType } from '../types';
import { UserAuthMeta } from './api.service';

const CategoryTranslates: any = {
  1: 'Upė',
  2: 'Kanalas',
  3: 'Natūralus ežeras',
  4: 'Patvenktas ežeras',
  5: 'Tvenkinys',
  6: 'Nepratekamas dirbtinis paviršinis vandens telkinys',
  7: 'Tarpinis vandens telkinys',
};

const getBox = (geom: GeomFeatureCollection, tolerance: number = 0.001) => {
  const coordinates: any = geom.features[0].geometry.coordinates;
  const topLeft = {
    lng: coordinates[0] - tolerance,
    lat: coordinates[1] + tolerance,
  };
  const bottomRight = {
    lng: coordinates[0] + tolerance,
    lat: coordinates[1] - tolerance,
  };
  return `${topLeft.lng},${bottomRight.lat},${bottomRight.lng},${topLeft.lat}`;
};

export interface Location {
  name: string;
  area: number;
  length: number;
  category: string;
  cadastral_id: string;
  municipality: {
    id: number;
    name: string;
  };
}

@Service({
  name: 'locations',
})
export default class LocationsService extends moleculer.Service {
  @Action({
    rest: 'GET /uetk',
    auth: RestrictionType.PUBLIC,
    params: {
      search: {
        type: 'string',
        optional: true,
      },
    },
    cache: false,
  })
  async uetkSearch(
    ctx: Context<
      {
        search?: string;
        query: any;
      },
      UserAuthMeta
    >,
  ) {
    const targetUrl = `${process.env.UETK_URL}/objects`;
    const params: any = ctx.params;
    const searchParams = new URLSearchParams(params);
    const query = {
      category: {
        $in: [
          'RIVER',
          'CANAL',
          'INTERMEDIATE_WATER_BODY',
          'TERRITORIAL_WATER_BODY',
          'NATURAL_LAKE',
          'PONDED_LAKE',
          'POND',
          'ISOLATED_WATER_BODY',
        ],
      },
      ...(params.query || {}),
    };
    searchParams.set('query', JSON.stringify(query));
    const queryString = searchParams.toString();

    const url = `${targetUrl}?${queryString}`;
    try {
      const data = await fetch(url).then((r) => r.json());
      const rows = await Promise.all(data?.rows?.map((item: any) => this.mapUETKObject(ctx, item)));
      return {
        ...data,
        rows,
      };
    } catch (error) {
      throw new Error(`Failed to fetch: ${error.message}`);
    }
  }

  @Action({
    rest: 'GET /uetk/:cadastralId',
    auth: RestrictionType.PUBLIC,
    params: {
      cadastralId: {
        type: 'string',
        optional: true,
      },
    },
  })
  async uetkSearchByCadastralId(
    ctx: Context<
      {
        cadastralId: string;
      },
      UserAuthMeta
    >,
  ) {
    const targetUrl = `${process.env.UETK_URL}/objects`;
    const params: any = ctx.params;
    const searchParams = new URLSearchParams(params);
    const query = {
      cadastralId: ctx.params.cadastralId,
    };
    searchParams.set('query', JSON.stringify(query));
    const queryString = searchParams.toString();

    const url = `${targetUrl}?${queryString}`;
    try {
      const data = await fetch(url).then((r) => r.json());
      if (!data?.rows?.[0]) return;
      return this.mapUETKObject(ctx, data?.rows?.[0]);
    } catch (error) {
      throw new Error(`Failed to fetch: ${error.message}`);
    }
  }

  @Action({
    rest: 'GET /',
    auth: RestrictionType.PUBLIC,
    params: {
      geom: 'string|optional',
      search: 'any|optional',
      withGeom: 'any|optional',
    },
    cache: false,
  })
  async search(
    ctx: Context<
      {
        search?: string;
        geom?: string;
        withGeom?: any;
      },
      UserAuthMeta
    >,
  ) {
    const { geom, search, withGeom, ...rest } = ctx.params;
    if (geom) {
      const geomJson: GeomFeatureCollection = JSON.parse(geom);
      const riverOrLake = await this.getRiverOrLakeFromPoint(geomJson);
      return riverOrLake;
    } else if (search) {
      //TODO: after releaseing frontend this part can be deleted
      const url =
        `${process.env.INTERNAL_API}/uetk/search?` + new URLSearchParams({ search, ...rest });
      const response = await fetch(url);

      const data = await response.json();

      return map(data.rows, (item) => {
        const location: any = {
          cadastral_id: item.properties.cadastral_id,
          name: item.properties.name,
          municipality: item.properties.municipality,
          area: item.properties.area,
        };
        if (withGeom === 'true') {
          location['geom'] = coordinatesToGeometry({
            x: item.properties.lon,
            y: item.properties.lat,
          });
        }
        return location;
      });
    }
  }

  @Action({
    rest: 'GET /municipalities/search',
    params: {
      geom: 'string|optional',
    },
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async searchMunicipalitiesByGeom(ctx: Context<{ geom?: string }>) {
    const geom: GeomFeatureCollection = JSON.parse(ctx.params.geom);
    return this.getMunicipalityFromPoint(geom);
  }

  @Action({
    rest: 'GET /municipalities',
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async getMunicipalities(ctx: Context) {
    const res = await fetch(
      `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=municipalities&OUTPUTFORMAT=application/json&propertyName=pavadinimas,kodas`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const data = await res.json();

    const items = data.features
      .map((f: any) => {
        return {
          name: f.properties.pavadinimas,
          id: parseInt(f.properties.kodas),
        };
      })
      .sort((s1: any, s2: any) => {
        return s1.name.localeCompare(s2.name);
      });

    return {
      rows: items,
      total: items.length,
    };
  }

  @Action({
    params: {
      id: 'number',
    },
  })
  async findMunicipalityById(ctx: Context<{ id: number }>) {
    const municipalities = await this.actions.getMunicipalities(null, {
      parentCtx: ctx,
    });
    return find(municipalities?.rows, { id: ctx.params.id });
  }

  @Method
  async getRiverOrLakeFromPoint(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      try {
        const box = getBox(geom, 200);
        const rivers = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=rivers&OUTPUTFORMAT=application/json&GEOMETRYNAME=centroid&BBOX=${box}`;
        const riversData = await fetch(rivers, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const riversResult = await riversData.json();
        const municipality = await this.getMunicipalityFromPoint(geom);
        const lakes = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=lakes_ponds&OUTPUTFORMAT=application/json&GEOMETRYNAME=centroid&BBOX=${box}`;
        const lakesData = await fetch(lakes, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const lakesResult = await lakesData.json();
        const list = [...riversResult.features, ...lakesResult.features];

        const mappedList = map(list, (item) => {
          return {
            cadastral_id: item.properties.kadastro_id,
            name: item.properties.pavadinimas,
            municipality: municipality,
            area: item.properties.st_area
              ? Math.round(item.properties.st_area / 100) / 100
              : undefined, //ha
            length: item.properties.ilgis_uetk, //km
            category: CategoryTranslates[item.properties.kategorija],
          };
        });
        return mappedList;
      } catch (err) {
        throw new moleculer.Errors.ValidationError(err.message);
      }
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }
  }

  @Method
  async mapUETKObject(ctx: Context, item: any) {
    return {
      name: item.name,
      cadastral_id: item.cadastralId,
      municipality: {
        name: item.municipality,
        id: item.municipalityCode,
      },
      area: item.area ? Math.round(item.area / 100) / 100 : undefined, //ha
      length: item.length ? Math.round(item.length / 10) / 100 : undefined, //km
      category: item.categoryTranslate,
    };
  }

  @Method
  async getMunicipalityFromPoint(geom: GeomFeatureCollection) {
    const box = getBox(geom);
    const endPoint = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=municipalities&OUTPUTFORMAT=application/json&BBOX=${box}`;
    const data = await fetch(endPoint, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { features } = await data.json();
    return {
      id: Number(features[0]?.properties?.kodas),
      name: features[0]?.properties?.pavadinimas || '',
    };
  }
}
