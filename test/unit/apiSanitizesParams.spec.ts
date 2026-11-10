import { ServiceBroker } from 'moleculer';
import ApiService from '../../services/api.service';

// Every gateway route must remove client-supplied raw SQL before the action is
// called: `@moleculer/database` passes `$raw` to knex `whereRaw` and a sort
// field starting with `&` to `orderByRaw`.
describe('api gateway removes client raw SQL', () => {
  const broker = new ServiceBroker({ logger: false });
  const service: any = broker.createService(ApiService as any);

  afterAll(() => broker.stop());

  it('on every route, before the action call', async () => {
    const routes = service.settings.routes;
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      expect(typeof route.onBeforeCall).toBe('function');
      const req: any = {
        headers: {},
        $params: {
          $raw: '1=0',
          query: '{"$raw":"1=0","a":1}',
          filter: { $raw: '1=0', b: 2 },
          nested: JSON.stringify(JSON.stringify({ $or: [{ $raw: '1=0' }] })),
          sort: '&id',
        },
      };
      try {
        await route.onBeforeCall.call(service, { meta: {} }, route, req, {});
      } catch (e) {
        // Other checks in the hook (e.g. an API key) may refuse the request;
        // the params must be cleaned before that.
      }
      expect(req.$params).toEqual({
        query: '{"a":1}',
        filter: { b: 2 },
        nested: '{"$or":[{}]}',
        sort: 'id',
      });
    }
  });
});
