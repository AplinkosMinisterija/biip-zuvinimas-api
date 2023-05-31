exports.up = function (knex) {
  return knex.schema.raw(`ALTER TABLE fish_stockings ALTER COLUMN geom type geometry(point, 3346)`);
};

exports.down = function (knex) {
  return knex.schema.raw(`ALTER TABLE fish_stockings ALTER COLUMN geom type geometry(geometry, 3346)`);
};
