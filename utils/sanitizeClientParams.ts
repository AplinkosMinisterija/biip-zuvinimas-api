// `@moleculer/database` hands a `$raw` value from a `query` (or a `filter`
// object) straight to knex `whereRaw`, so a `$raw` may only ever be built by
// server code. These keys are never copied from client params: `$raw` reaches
// SQL, the others can replace an object's prototype when params are merged.
const DROPPED_KEYS = new Set(['$raw', '__proto__', 'constructor', 'prototype']);

// How many times a JSON string is decoded when looking for an object inside.
// Actions may JSON.parse a value more than once (their own parsing, then the
// database mixin), so a double-encoded query must be unwrapped here too.
const MAX_JSON_DEPTH = 5;

function isOpaqueObject(value: any): boolean {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Date ||
    ArrayBuffer.isView(value) ||
    typeof value.pipe === 'function'
  );
}

function decodeJsonObject(value: string): object | undefined {
  let current: any = value;
  for (let i = 0; i < MAX_JSON_DEPTH; i++) {
    if (typeof current !== 'string') break;
    const trimmed = current.trim();
    if (!/^[{["]/.test(trimmed)) return undefined;
    try {
      current = JSON.parse(trimmed);
    } catch (err) {
      return undefined;
    }
  }
  return current && typeof current === 'object' ? current : undefined;
}

// The knex adapter runs a sort field starting with `&` through `orderByRaw`,
// so `&` is removed from every client `sort` value (also inside a JSON string
// and its `\u0026` escape). No real field name contains `&`.
function sanitizeSort(value: unknown): unknown {
  if (typeof value === 'string') {
    const decoded = decodeJsonObject(value);
    if (decoded) {
      const cleaned = sanitizeSort(decoded);
      return JSON.stringify(cleaned) === JSON.stringify(decoded) ? value : JSON.stringify(cleaned);
    }
    // Repeated until stable, so removing one escape cannot form another.
    let prev: string;
    let out = value;
    do {
      prev = out;
      out = out.replace(/&|\\u0026/gi, '');
    } while (out !== prev);
    return out;
  }
  if (Array.isArray(value)) return value.map(sanitizeSort);
  return sanitizeClientParams(value);
}

/**
 * Sanitizes request parameters coming from HTTP clients: removes `$raw` (and
 * prototype-changing keys) at any depth, also inside values sent as JSON
 * strings, including double-encoded ones (e.g. `?query={"$raw":"..."}`), and
 * raw (`&`) fields from `sort`.
 * Escaped keys such as `"$raw"` are caught because the string is
 * decoded, not searched. A string is replaced only when something was
 * removed, so all other values keep their type and exact form.
 *
 * Every object is rebuilt from its own keys, whatever its prototype, so a
 * `__proto__` key in a JSON body cannot make it skip sanitizing.
 */
export function sanitizeClientParams<T>(value: T): T {
  if (typeof value === 'string') {
    const decoded = decodeJsonObject(value);
    if (!decoded) return value;

    const cleaned = sanitizeClientParams(decoded);
    return (JSON.stringify(cleaned) === JSON.stringify(decoded)
      ? value
      : JSON.stringify(cleaned)) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeClientParams) as unknown as T;
  }

  if (value && typeof value === 'object') {
    if (isOpaqueObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (DROPPED_KEYS.has(key)) continue;
      const item = (value as Record<string, unknown>)[key];
      out[key] = key === 'sort' ? sanitizeSort(item) : sanitizeClientParams(item);
    }
    return out as T;
  }

  return value;
}

/**
 * moleculer-web `onBeforeCall` hook: runs after body parsing, right before the
 * action call, and `req.$params` is exactly what the action receives.
 */
export function stripClientRaw(_ctx: unknown, _route: unknown, req: any) {
  if (req.$params) req.$params = sanitizeClientParams(req.$params);
}
