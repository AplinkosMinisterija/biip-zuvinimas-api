'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import ApiGateway from 'moleculer-web';
import { RequestMessage, RestrictionType, throwNoRightsError } from '../types';
import { FREELANCER_PROFILE_ID } from './tenantUsers.service';
import { User } from './users.service';

export interface UserAuthMeta {
  user: User;
  app: any;
  authToken: string;
  authUser: any;
  profile: any;
}

export enum AuthUserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

@Service({
  name: 'api',
  mixins: [ApiGateway],
  // More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
  // TODO: helmet
  settings: {
    port: process.env.PORT || 3000,
    path: '/zuvinimasnew',

    // Global CORS settings for all routes
    cors: {
      // Configures the Access-Control-Allow-Origin CORS header.
      origin: '*',
      // Configures the Access-Control-Allow-Methods CORS header.
      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
      // Configures the Access-Control-Allow-Headers CORS header.
      allowedHeaders: '*',
      // Configures the Access-Control-Max-Age CORS header.
      maxAge: 3600,
    },

    routes: [
      {
        path: '',
        aliases: {
          'GET /ping': 'api.ping',
        },
      },
      {
        path: '/uml',
        aliases: {
          'GET /': 'uml.generate',
          'GET /entity': 'uml.entity.generate',
        },
      },
      // moleculer-auto-openapi routes
      {
        path: '/api/openapi',
        aliases: {
          'GET /openapi.json': 'openapi.generateDocs', // swagger scheme
          'GET /ui': 'openapi.ui', // ui
          'GET /assets/:file': 'openapi.assets', // js/css files
        },
      },
      {
        path: '/api',
        whitelist: [
          // Access to any actions in all services under "/api" URL
          '**',
        ],

        // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
        use: [],

        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {},

        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '1MB',
          },
          urlencoded: {
            extended: true,
            limit: '1MB',
          },
        },

        // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
      },
    ],
    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    log4XXResponses: false,
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    logRequestParams: null,
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    logResponseData: null,
    // Serve assets from "public" folder
    assets: {
      folder: 'public',
      // Options to `server-static` module
      options: {},
    },
  },
})
export default class ApiService extends moleculer.Service {
  @Method
  getRestrictionType(req: RequestMessage) {
    return req.$action.auth || req.$action.service?.settings?.auth || RestrictionType.DEFAULT;
  }

  @Method
  async authenticate(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    _route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const restrictionType = this.getRestrictionType(req);

    if (restrictionType === RestrictionType.PUBLIC) {
      return null;
    }

    // Read the token from header
    const auth = req.headers.authorization;
    if (!auth?.startsWith?.('Bearer')) {
      throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN, null);
    }

    const token = auth.slice(7);

    // it will throw error if token not valid
    const authUser: any = await ctx.call('auth.users.resolveToken', null, {
      meta: { authToken: token },
    });

    let user: User;
    if (authUser.type === AuthUserRole.USER) {
      user = await ctx.call('users.findOne', {
        query: {
          authUser: authUser.id,
        },
      });
      const profile = req.headers['x-profile'] as any;
      if (!!profile && profile !== FREELANCER_PROFILE_ID) {
        const currentTenantUser = await ctx.call('tenantUsers.findOne', {
          query: {
            tenant: profile,
            user: user.id,
          },
        });
        if (!currentTenantUser) {
          throwNoRightsError('Unauthorized');
        }
        ctx.meta.profile = profile;
      }
    }

    ctx.meta.authUser = authUser;
    ctx.meta.authToken = token;
    ctx.meta.user = user;

    return user;
  }

  @Method
  async authorize(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    _route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const restrictionType = this.getRestrictionType(req);

    if (restrictionType === RestrictionType.PUBLIC) {
      return;
    }

    // Get the authenticated user.
    const authUser = ctx.meta.authUser;

    if (
      restrictionType === RestrictionType.ADMIN &&
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].includes(authUser.type)
    ) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }

    if (restrictionType === RestrictionType.USER && authUser.type !== AuthUserRole.USER) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }
  }

  @Action()
  ping() {
    return {
      timestamp: Date.now(),
    };
  }
}
