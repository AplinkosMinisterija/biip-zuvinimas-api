'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { coordinatesToGeometry } from '../modules/geometry';
import {
  COMMON_PAGINATION_PARAMS,
  RestrictionType,
} from '../types';
import { UserAuthMeta } from './api.service';
import {serializeQuery} from "../utils/functions";

@Service({
  name: 'locations',
})
export default class LocationsService extends moleculer.Service {
  @Action({
    rest: 'GET /',
    auth: RestrictionType.PUBLIC,
    params: {
      geom: 'string|optional',
      search: 'any|optional',
      withGeom: 'any|optional',
      ...COMMON_PAGINATION_PARAMS,
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
    const { geom, search, withGeom, ...options } = ctx.params;
    let url = '';
    if (geom) {
      url = `${process.env.INTERNAL_API}/uetk/search?query[geom]=${geom}${serializeQuery(
          options
      )}`;
    } else if (search) {
      url = `${process.env.INTERNAL_API}/uetk/search?search=${search}&searchFields[]=name&searchFields[]=cadastral_id${serializeQuery(
          options
      )}`;
    }
    if(!url) {
      throw new moleculer.Errors.ValidationError('Invalid search params');
    }
    const response = await fetch(url);
    const data = await response.json();
    return {
    ...data,
    rows: data.rows.map((item: any) => ({
      cadastral_id: item.properties?.cadastral_id,
      name: item.properties?.name,
      municipality: item.properties?.municipality,
      ...(!!withGeom && { geom : coordinatesToGeometry({
          x: item.properties.lon,
          y: item.properties.lat,
        })}),
    }))}
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
}
