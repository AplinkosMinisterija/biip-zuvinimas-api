exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.timestamp('canceledAt');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('canceledAt');
  });
};
