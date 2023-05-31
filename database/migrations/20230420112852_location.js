exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('location');
  });

  await knex.schema.alterTable('fishStockings', (table) => {
    table.string('location');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('location');
  });

  await knex.schema.alterTable('fishStockings', (table) => {
    table.jsonb('location');
  });
};
