const { commonFields } = require('./20230405144107_setup');

exports.up = function (knex) {
  return knex.schema.createTable('recentLocations', (table) => {
    table.increments('id');
    table.integer('tenant');
    table.integer('user');
    table.jsonb('recent');
    commonFields(table);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('recent_locations');
};
