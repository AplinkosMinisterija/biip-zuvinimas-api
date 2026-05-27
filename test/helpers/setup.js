// Test environment bootstrap. Loaded by jest BEFORE any test module is required
// (via `setupFiles` in jest.config.js), so the env vars are already in place
// when biip-auth-nodejs and other modules read process.env at import time.

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';

// PostgreSQL: spun up via docker-compose on port 5449 (see docker-compose.yml).
// Tests use a SEPARATE database `zuvinimas_test` so they can drop/recreate
// without nuking dev data.
process.env.DB_CONNECTION =
  process.env.DB_CONNECTION ||
  'postgresql://postgres:postgres@localhost:5449/zuvinimas_test';

// Redis: disabled in tests — the api uses Redis caching for `public.*` reads.
// We set REDIS_CONNECTION to a no-op value; moleculer.config.ts honors it but
// the cacher writes are best-effort so tests don't depend on Redis.
process.env.REDIS_CONNECTION =
  process.env.REDIS_CONNECTION || 'redis://localhost:6141';

// MinIO: tests never actually upload to MinIO, but minio.service requires
// the env vars to be set or it calls broker.fatal('MINIO is not configured').
process.env.MINIO_ENDPOINT = 'localhost';
process.env.MINIO_PORT = '9140';
process.env.MINIO_USESSL = 'false';
process.env.MINIO_ACCESSKEY = 'minioadmin';
process.env.MINIO_SECRETKEY = 'minioadmin';
process.env.MINIO_BUCKET = 'zuvinimas-test';

// External auth service: zuvinimas uses biip-auth-nodejs mixin, which would
// normally call AUTH_HOST over HTTP. In tests we REPLACE the `auth` service
// with a stub (see test/helpers/mockAuth.ts), so AUTH_HOST is never reached —
// but the mixin module checks the value at import time.
process.env.AUTH_API_KEY = 'test-auth-api-key';
process.env.AUTH_HOST = 'http://test-auth-host.invalid';
process.env.URL = 'http://localhost:3000';

// External integrations referenced by services — set to invalid hosts so any
// accidental real HTTP attempt fails loudly during tests.
process.env.INTERNAL_API = 'http://test-internal.invalid';
process.env.GEO_SERVER = 'http://test-geo.invalid';
process.env.POSTMARK_KEY = 'test-postmark-key';
process.env.ADMIN_HOST = 'http://test-admin.invalid';

// Numeric env IDs read by services. Use distinct sentinel values so tests can
// assert against them.
process.env.FREELANCER_GROUP_ID = '9001';
process.env.AUTH_AAD_GROUP_ID = '9002';
process.env.ZUVININKYSTES_TARNYBA_ID = '9003';
