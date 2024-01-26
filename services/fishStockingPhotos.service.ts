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
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';
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
    const entity: FishStockingPhoto = await this.createEntity(ctx, {
      name: ctx.meta.filename,
      fishStocking: ctx.meta.$multipart.fishStocking,
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
  })
  async remove(ctx: Context<any>) {
    const entity: FishStockingPhoto = await this.resolveEntities(ctx, {
      id: Number(ctx.params.id),
    });
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
  getObjectName(entity: FishStockingPhoto) {
    const extension = entity.name.split('.').pop();
    return `${this.name}/${entity.id}.${extension}`;
  }
}
