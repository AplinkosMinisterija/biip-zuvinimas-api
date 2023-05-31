const { commonFields } = require('./20230405144107_setup');

exports.up = function (knex) {
  return knex.schema.createTable('mandatoryLocations', (table) => {
    table.increments('id');
    table.jsonb('location');
    commonFields(table);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('mandatoryLocations');
};
