/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
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
        "id" AS "fishStockingId",
        "event_time"
    FROM fish_stockings
    ORDER BY location->>'cadastral_id', "user_id", "tenant_id", "event_time" DESC;
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
        "tenant_id",
        "created_by" AS user_id,
        "id" AS "fishStockingId",
        "event_time"
    FROM fish_stockings
    ORDER BY location->>'cadastral_id', "user_id", "tenant_id", "event_time" DESC;
  `);
};
