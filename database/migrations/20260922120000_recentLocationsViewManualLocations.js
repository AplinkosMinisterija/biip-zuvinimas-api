/**
 * Hand-typed water bodies have no cadastral id, so keying on it alone collapsed
 * all of a user's manual locations into a single NULL row.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.raw(`
    DROP VIEW IF EXISTS recent_locations;
    CREATE VIEW recent_locations AS
    SELECT DISTINCT ON (COALESCE(location->>'cadastral_id', location->>'name'), "created_by", "tenant_id")
        location->>'name' AS name,
        location->>'cadastral_id' AS cadastral_id,
        location->>'municipality' AS municipality,
        location->>'area' AS area,
        location->>'length' AS length,
        location->>'category' AS category,
        "tenant_id",
        "created_by" AS user_id,
        "id" AS "fish_stocking_id",
        "event_time"
    FROM fish_stockings
    ORDER BY COALESCE(location->>'cadastral_id', location->>'name'), "user_id", "tenant_id", "event_time" DESC;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`
    DROP VIEW IF EXISTS recent_locations;
    CREATE VIEW recent_locations AS
    SELECT DISTINCT ON (location->>'cadastral_id', "created_by", "tenant_id")
        location->>'name' AS name,
        location->>'cadastral_id' AS cadastral_id,
        location->>'municipality' AS municipality,
        location->>'area' AS area,
        location->>'length' AS length,
        location->>'category' AS category,
        "tenant_id",
        "created_by" AS user_id,
        "id" AS "fish_stocking_id",
        "event_time"
    FROM fish_stockings
    ORDER BY location->>'cadastral_id', "user_id", "tenant_id", "event_time" DESC;
  `);
};
