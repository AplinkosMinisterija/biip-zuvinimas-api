exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE EXTENSION IF NOT EXISTS postgis;`)
    .raw(`ALTER TABLE fish_stockings ADD COLUMN geom geometry(geometry, 3346)`);
};

exports.down = function (knex) {
  return knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('geom');
  });
};
