'use strict';

import Moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
// @ts-ignore
import MinioMixin from 'moleculer-minio';

// All MinioMixin actions are lifted to `visibility: 'protected'` so that they
// remain callable internally via `ctx.call('minio.<action>', ...)` from other
// services (e.g. fishStockingPhotos) but are NOT reachable through the
// moleculer-web HTTP gateway, which runs with `mappingPolicy: 'all'` and
// `whitelist: ['**']`. Without this, an authenticated USER could hit e.g.
// `POST /api/minio/fPutObject {filePath:"/etc/passwd",...}` and trivially read
// or write arbitrary files on the API host filesystem.
@Service({
  name: 'minio',
  mixins: [MinioMixin],
  settings: {
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT),
    useSSL: process.env.MINIO_USESSL === 'true',
    accessKey: process.env.MINIO_ACCESSKEY,
    secretKey: process.env.MINIO_SECRETKEY,
  },
  actions: {
    makeBucket: { visibility: 'protected' },
    listBuckets: { visibility: 'protected' },
    bucketExists: { visibility: 'protected' },
    removeBucket: { visibility: 'protected' },
    listObjects: { visibility: 'protected' },
    listObjectsV2: { visibility: 'protected' },
    listIncompleteUploads: { visibility: 'protected' },
    getObject: { visibility: 'protected' },
    getPartialObject: { visibility: 'protected' },
    fGetObject: { visibility: 'protected' },
    putObject: { visibility: 'protected' },
    fPutObject: { visibility: 'protected' },
    copyObject: { visibility: 'protected' },
    statObject: { visibility: 'protected' },
    removeObject: { visibility: 'protected' },
    removeObjects: { visibility: 'protected' },
    removeIncompleteUpload: { visibility: 'protected' },
    presignedUrl: { visibility: 'protected' },
    presignedGetObject: { visibility: 'protected' },
    presignedPutObject: { visibility: 'protected' },
    presignedPostPolicy: { visibility: 'protected' },
  },
})
export default class MinioService extends Moleculer.Service {
  @Action({
    visibility: 'protected',
    params: {
      bucketName: 'string',
      objectName: 'string',
    },
  })
  publicUrl(
    ctx: Context<{
      bucketName: string;
      objectName: string;
    }>,
  ) {
    return (
      this.client.protocol +
      '//' +
      this.client.host +
      ':' +
      this.client.port +
      '/' +
      ctx.params.bucketName +
      '/' +
      ctx.params.objectName
    );
  }

  async started() {
    const bucketExists: boolean = await this.actions.bucketExists({
      bucketName: process.env.MINIO_BUCKET,
    });

    if (!bucketExists) {
      await this.actions.makeBucket({
        bucketName: process.env.MINIO_BUCKET,
      });
    }

    // mc anonymous set download myminio/medziokle/animalIcons/
    // await this.client.setBucketPolicy(
    //   process.env.MINIO_BUCKET,
    //   JSON.stringify({
    //     Version: '2012-10-17',
    //     Statement: [
    //       {
    //         Effect: 'Allow',
    //         Principal: {
    //           AWS: ['*'],
    //         },
    //         Action: ['s3:GetObject'],
    //         Resource: [
    //           // `arn:aws:s3:::${process.env.MINIO_BUCKET}/animalIcons/*`,
    //           // `arn:aws:s3:::${process.env.MINIO_BUCKET}/footprintPhotos/*`,
    //           // ... for all public download folderos
    //         ],
    //       },
    //     ],
    //   }),
    // );
  }

  created() {
    if (!process.env.MINIO_ACCESSKEY || !process.env.MINIO_SECRETKEY) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
