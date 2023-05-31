exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.jsonb('inspector');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('inspector');
  });
};
