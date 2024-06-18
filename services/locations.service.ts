'use strict';

import { find, map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { GeomFeatureCollection, coordinatesToGeometry } from '../modules/geometry';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';
import { UserAuthMeta } from './api.service';
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

interface Fields extends CommonFields {
  cadastral_id: string;
  name: string;
  municipality: {
    id: number;
    name: string;
  };
}

interface Populates extends CommonPopulates {}

export type Location<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

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
    const targetUrl = `${process.env.UETK_URL}/objects/search`;
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
      const municipalities = await this.actions.getMunicipalities(null, { parentCtx: ctx });
      const rows = data?.rows?.map((item: any) => ({
        name: item.name,
        cadastral_id: item.cadastralId,
        municipality: municipalities?.rows?.find((m: any) => m.name === item.municipality),
        area: item.area,
      }));

      return {
        ...data,
        rows,
      };
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
              ? (item.properties.st_area / 10000).toFixed(2)
              : undefined,
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

  @Action({
    rest: 'GET /municipalities/search',
    params: {
      geom: 'string|optional',
    },
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async searchMunicipalities(ctx: Context<{ geom?: string }>) {
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

  @Action({
    params: {
      name: 'string',
    },
  })
  async searchMunicipality(ctx: Context<{ name: string }>) {
    const municipalities = await this.actions.getMunicipalities(null, {
      parentCtx: ctx,
    });
    return find(municipalities?.rows, { name: ctx.params.name });
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
