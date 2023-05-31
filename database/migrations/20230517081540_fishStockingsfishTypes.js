exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.jsonb('fishTypes');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('fishTypes');
  });
};
