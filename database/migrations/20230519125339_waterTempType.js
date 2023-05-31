exports.up = function (knex) {
  return knex.schema.raw(
    `ALTER TABLE fish_stockings ALTER COLUMN water_temp type float, ALTER COLUMN container_water_temp type float`,
  );
};

exports.down = function (knex) {
  return knex.schema.raw(
    `ALTER TABLE fish_stockings ALTER COLUMN water_temp type int, ALTER COLUMN container_water_temp type int`,
  );
};
