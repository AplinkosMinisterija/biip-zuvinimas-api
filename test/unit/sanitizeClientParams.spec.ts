import { sanitizeClientParams } from '../../utils/sanitizeClientParams';

describe('sanitizeClientParams', () => {
  it('removes $raw from an object query (qs bracket notation)', () => {
    const params = { pageSize: '1', query: { $raw: '1=0', name: 'Neris' } };
    expect(sanitizeClientParams(params)).toEqual({
      pageSize: '1',
      query: { name: 'Neris' },
    });
  });

  it('removes $raw from a query sent as a JSON string and keeps it a string', () => {
    const params = { query: '{"$raw":"1=0","name":"Neris"}' };
    const out = sanitizeClientParams(params);
    expect(typeof out.query).toBe('string');
    expect(JSON.parse(out.query)).toEqual({ name: 'Neris' });
  });

  it('catches a unicode-escaped $raw key inside a JSON string', () => {
    const params = { query: '{"\\u0024raw":"1=0"}' };
    expect(JSON.parse(sanitizeClientParams(params).query)).toEqual({});
  });

  it('removes nested $raw in JSON strings ($or / $and)', () => {
    const params = { query: '{"$or":[{"$raw":"1=0"},{"x":{"$raw":"y"}}]}' };
    expect(JSON.parse(sanitizeClientParams(params).query)).toEqual({
      $or: [{}, { x: {} }],
    });
  });

  it('removes $raw from body-like params and filter', () => {
    const params = {
      $raw: 'a',
      filter: '{"$raw":"b","status":"APPROVED"}',
      query: { $and: [{ $raw: 'c' }] },
    };
    const out = sanitizeClientParams(params);
    expect(out).toEqual({
      filter: '{"status":"APPROVED"}',
      query: { $and: [{}] },
    });
  });

  it('leaves params without $raw exactly as they were', () => {
    const query = '{ "name": "Neris", "id": { "$in": [1, 2] } }';
    const params = { query, search: 'Nemunas', page: '2', flag: true };
    const out = sanitizeClientParams(params);
    expect(out.query).toBe(query);
    expect(out).toEqual(params);
  });

  it('does not touch plain text, invalid JSON and JSON primitives', () => {
    expect(sanitizeClientParams('$raw')).toBe('$raw');
    expect(sanitizeClientParams('{not json')).toBe('{not json');
    expect(sanitizeClientParams('123')).toBe('123');
    expect(sanitizeClientParams('"just text"')).toBe('"just text"');
  });

  it('removes $raw from a double-encoded JSON string', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ $raw: '1=0', a: 1 }));
    const out = sanitizeClientParams({ query: doubleEncoded });
    expect(JSON.parse(out.query)).toEqual({ a: 1 });
  });

  it('keeps a double-encoded JSON string without $raw unchanged', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ a: 1 }));
    expect(sanitizeClientParams(doubleEncoded)).toBe(doubleEncoded);
  });

  it('sanitizes an object whose prototype was replaced via __proto__', () => {
    // What moleculer-web does: Object.assign(params, body, query) with a JSON
    // body that has a "__proto__" key.
    const body = JSON.parse('{"__proto__":{"x":1},"query":{"$raw":"1=0","a":1}}');
    const params = Object.assign({}, body);
    expect(Object.getPrototypeOf(params)).not.toBe(Object.prototype);
    const out: any = sanitizeClientParams(params);
    expect(out).toEqual({ query: { a: 1 } });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('drops __proto__, constructor and prototype keys at any depth', () => {
    const body = JSON.parse(
      '{"query":{"__proto__":{"$raw":"1=0"},"constructor":{"a":1},"prototype":1,"b":2}}',
    );
    const out: any = sanitizeClientParams(body);
    expect(out).toEqual({ query: { b: 2 } });
    expect(Object.getPrototypeOf(out.query)).toBe(Object.prototype);
  });

  it('keeps non-plain objects untouched', () => {
    const buf = Buffer.from('x');
    const date = new Date(0);
    const out = sanitizeClientParams({ buf, date });
    expect(out.buf).toBe(buf);
    expect(out.date).toBe(date);
  });
});

describe('sanitizeClientParams sort', () => {
  // The knex adapter passes a sort field starting with `&` to orderByRaw.
  const esc = String.fromCharCode(92) + 'u0026x';

  it('removes raw (&) sort fields in every form', () => {
    expect(sanitizeClientParams({ sort: '&(SELECT/**/1),-name' })).toEqual({
      sort: '(SELECT/**/1),-name',
    });
    expect(sanitizeClientParams({ sort: ['&x', '-name'] })).toEqual({
      sort: ['x', '-name'],
    });
    expect(sanitizeClientParams({ sort: '["&x"]' })).toEqual({ sort: '["x"]' });
    expect(sanitizeClientParams({ sort: esc })).toEqual({ sort: 'x' });
    expect(sanitizeClientParams({ sort: '["' + esc + '"]' })).toEqual({
      sort: '["x"]',
    });
  });

  it('removes an escape formed by removing another', () => {
    const b = String.fromCharCode(92);
    const nested = '["' + b + 'u00' + b + 'u002626x"]';
    expect(sanitizeClientParams({ sort: nested })).toEqual({ sort: '["x"]' });
  });

  it('keeps ordinary sort values unchanged', () => {
    expect(sanitizeClientParams({ sort: '-createdAt,name' })).toEqual({
      sort: '-createdAt,name',
    });
    expect(sanitizeClientParams({ sort: ['name'] })).toEqual({ sort: ['name'] });
  });
});
