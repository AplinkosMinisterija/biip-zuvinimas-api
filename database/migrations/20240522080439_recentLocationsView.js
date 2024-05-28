/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const { commonFields } = require('./20230405144107_setup');
exports.up = function (knex) {
  return knex.schema.dropTable('recentLocations').raw(`
    CREATE VIEW recent_locations AS
    SELECT DISTINCT ON (location->>'cadastral_id', "created_by", "tenant_id")
        location->>'name' AS name,
        location->>'cadastral_id' AS cadastral_id,
        location->>'municipality' AS municipality,
        "tenant_id",
        "created_by" AS user_id,
        "id" AS "geom",
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
  return knex.schema.dropView('recentLocations').createTable('recentLocations', (table) => {
    table.increments('id');
    table.integer('tenant');
    table.integer('user');
    table.jsonb('recent');
    commonFields(table);
  });
};
