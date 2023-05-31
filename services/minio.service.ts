'use strict';

import Moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
// @ts-ignore
import MinioMixin from 'moleculer-minio';

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
})
export default class MinioService extends Moleculer.Service {
  @Action({
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
    const bucketExists: boolean =
      await this.actions.bucketExists({
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
    if (
      !process.env.MINIO_ACCESSKEY ||
      !process.env.MINIO_SECRETKEY
    ) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
