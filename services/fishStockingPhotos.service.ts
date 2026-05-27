'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  FieldHookCallback,
  MultipartMeta,
  RestrictionType,
  Table,
  throwNoRightsError,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { FishStocking } from './fishStockings.service';

interface Fields extends CommonFields {
  id: number;
  name: string;
  fishStocking: FishStocking['id'];
}

interface Populates extends CommonPopulates {
  fishStocking: FishStocking;
}

export type FishStockingPhoto<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

//TODO: could be refactored to store fishStocking photos as json object in fishStockingsTable instead of separate database table
@Service({
  name: 'fishStockingPhotos',
  mixins: [
    DbConnection({
      createActions: {
        create: false,
        createMany: false,
        update: false,
      },
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      fishStocking: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishStockingId',
        required: true,
        immutable: true,
        populate: {
          action: 'fishStocking.resolve',
        },
      },
      url: {
        virtual: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('minio.presignedGetObject', {
            bucketName: process.env.MINIO_BUCKET,
            objectName: this.getObjectName(entity),
            expires: 60000,
            reqParams: {},
            requestDate: new Date().toDateString(),
          });
        },
      },
      name: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FishStockingPhotosService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 5,
        },
      },
    },
    auth: RestrictionType.DEFAULT,
  })
  async createAction(
    ctx: Context<NodeJS.ReadableStream, UserAuthMeta & MultipartMeta & { fishStocking: number }>,
  ) {
    if (!['image/png', 'image/jpg', 'image/jpeg'].includes(ctx.meta.mimetype)) {
      throw new moleculer.Errors.MoleculerClientError(
        'Unsupported MIME type.',
        400,
        'UNSUPPORTED_MIMETYPE',
      );
    }

    const fishStockingId = Number(ctx.meta.$multipart.fishStocking);
    if (!Number.isFinite(fishStockingId)) {
      throw new moleculer.Errors.ValidationError('Invalid fishStocking id');
    }
    await this.assertCanManageFishStocking(ctx, fishStockingId);

    const entity: FishStockingPhoto = await this.createEntity(ctx, {
      name: ctx.meta.filename,
      fishStocking: fishStockingId,
    });

    try {
      await ctx.call('minio.putObject', ctx.params, {
        meta: {
          bucketName: process.env.MINIO_BUCKET,
          objectName: this.getObjectName(entity),
          metaData: {
            'Content-Type': ctx.meta.mimetype,
          },
        },
      });
    } catch (_e) {
      await this.removeEntity(ctx, { id: entity.id });
    }
    return this.resolveEntities(ctx, { id: entity.id });
  }

  @Action({
    rest: 'DELETE /:id',
    auth: RestrictionType.DEFAULT,
  })
  async remove(ctx: Context<any, UserAuthMeta>) {
    const entity: FishStockingPhoto = await this.resolveEntities(ctx, {
      id: Number(ctx.params.id),
    });
    if (!entity) {
      throw new moleculer.Errors.MoleculerClientError('Not found', 404, 'NOT_FOUND');
    }
    await this.assertCanManageFishStocking(ctx, entity.fishStocking);

    try {
      await ctx.call('minio.removeObject', {
        bucketName: process.env.MINIO_BUCKET,
        objectName: this.getObjectName(entity),
      });
    } catch (e: unknown) {
      this.logger.error(e);
    }
    return this.removeEntity(ctx);
  }

  @Method
  async assertCanManageFishStocking(ctx: Context<any, UserAuthMeta>, fishStockingId: number) {
    // Admins (incl. SUPER_ADMIN) are allowed to manage photos for any fish stocking.
    if (
      ctx.meta?.authUser?.type === AuthUserRole.ADMIN ||
      ctx.meta?.authUser?.type === AuthUserRole.SUPER_ADMIN
    ) {
      return;
    }

    const fishStocking: FishStocking = await ctx.call('fishStockings.resolve', {
      id: fishStockingId,
      scope: false,
    });
    if (!fishStocking) {
      throwNoRightsError('Invalid fishStocking id');
    }

    const userId = ctx.meta?.user?.id;
    const profile = ctx.meta?.profile;

    // Tenant/stockingCustomer ID columns are integers in DB but typed as string
    // through Tenant['id']. Compare as numbers for safety.
    const tenantId = Number(fishStocking.tenant);
    const stockingCustomerId = Number(fishStocking.stockingCustomer);

    // Tenant session: caller must belong to the owning tenant or be the stocking customer.
    if (profile) {
      const profileId = Number(profile);
      if (
        Number.isFinite(profileId) &&
        (tenantId === profileId || stockingCustomerId === profileId)
      ) {
        return;
      }
      throwNoRightsError('Fish stocking does not belong to this tenant');
    }

    // Freelancer session: must own the fish stocking AND it must not be a tenant stocking.
    if (userId && !fishStocking.tenant && Number(fishStocking.createdBy) === Number(userId)) {
      return;
    }

    throwNoRightsError('No rights to manage this fish stocking');
  }
  @Method
  getObjectName(entity: FishStockingPhoto) {
    const extension = entity.name.split('.').pop();
    return `${this.name}/${entity.id}.${extension}`;
  }
}
