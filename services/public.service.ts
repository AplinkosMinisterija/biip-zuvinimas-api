'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';

import { GeomFeature } from '../modules/geometry';
import { FishBatch } from './fishBatches.service';
import { FishStockingPhoto } from './fishStockingPhotos.service';
import { FishStocking } from './fishStockings.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  eventTime: Date;
  comment?: string;
  tenant?: Tenant['id'];
  stockingCustomer?: Tenant['id'];
  fishOrigin: string;
  fishOriginCompanyName?: string;
  fishOriginReservoir?: {
    id: string;
    name: string;
    municipality: { id: string; label: string };
  };
  location: GeomFeature;
  geom: any;
  batches: Array<FishBatch['id']>;
  assignedTo: User['id'];
  phone: string;
  reviewedBy?: User['id'];
  reviewLocation?: { lat: number; lng: number };
  reviewTime?: Date;
  waybillNo?: string;
  veterinaryApprovalNo?: string;
  veterinaryApprovalOrderNo?: string;
  containerWaterTemp?: number;
  waterTemp?: number;
  images?: FishStockingPhoto['id'];
  signatures?: {
    organization: string;
    signedBy: string;
    signature: string;
  }[];
  assignedToInspector?: number;
}

interface Populates extends CommonPopulates {}

export type FishAge<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'public',
})
export default class FishAgesService extends moleculer.Service {
  @Action({
    rest: 'GET /fishStockings',
    auth: RestrictionType.PUBLIC,
  })
  async getPublicFishStockings(ctx: Context<any>) {
    const params = {
      ...ctx.params,
      fields: [
        'id',
        'eventTime',
        'location',
        'coordinates',
        'status',
        'batches',
        'deletedAt',
        'canceledAt',
      ],
      populate: ['location', 'coordinates', 'status', 'batches'],
    };
    return ctx.call('fishStockings.find', params);
  }

  @Action({
    rest: 'GET /statistics',
    auth: RestrictionType.PUBLIC,
  })
  async getStatistics(ctx: Context<any>) {
    const completedFishStockings: FishStocking[] = await ctx.call('fishStockings.count', {
      filter: {
        status: ['FINISHED', 'INSPECTED'],
      },
    });

    const locationsCount = await ctx.call('fishStockings.getLocationsCount');

    const fishCount = await ctx.call('fishStockings.getFishCount');

    return {
      fish_stocking_count: completedFishStockings,
      fishing_area_count: locationsCount,
      fish_count: fishCount,
    };
  }
}
