/**
 * Performance indexes for fishStockings list endpoint.
 *
 * Without these the list query (sort -event_time + tenant/freelancer scope)
 * does a sequential scan + sort on the full fish_stockings table on every page,
 * and the status filter EXISTS subquery rescans fish_batches per row.
 *
 * CONCURRENTLY avoids locking writes while indexes build. Knex wraps each
 * migration in a transaction by default and CONCURRENTLY can't run inside
 * one, so we disable the transaction for this migration. IF NOT EXISTS makes
 * the migration safe to re-run (PG 9.5+).
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fish_stockings_event_time
      ON fish_stockings (event_time DESC)
      WHERE deleted_at IS NULL;
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fish_stockings_tenant_id
      ON fish_stockings (tenant_id)
      WHERE deleted_at IS NULL;
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fish_stockings_stocking_customer_id
      ON fish_stockings (stocking_customer_id)
      WHERE deleted_at IS NULL;
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fish_stockings_created_by_freelancer
      ON fish_stockings (created_by)
      WHERE deleted_at IS NULL AND tenant_id IS NULL;
  `);
  // Note: a GIN(location jsonb_path_ops) index was considered but skipped —
  // existing JSONB filters (ILIKE on name, scalar = on municipality.id) only
  // use text extraction, not @> containment, so jsonb_path_ops would never be
  // chosen by the planner. If the admin municipality filter is still slow
  // after the tenant/event_time indexes ship, add a B-tree expression index
  // on (((location::jsonb->'municipality'->>'id')::int)) instead.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fish_batches_review_exists
      ON fish_batches (fish_stocking_id)
      WHERE deleted_at IS NULL AND review_amount IS NOT NULL;
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS idx_fish_batches_review_exists;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS idx_fish_stockings_created_by_freelancer;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS idx_fish_stockings_stocking_customer_id;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS idx_fish_stockings_tenant_id;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS idx_fish_stockings_event_time;`);
};

exports.config = { transaction: false };
