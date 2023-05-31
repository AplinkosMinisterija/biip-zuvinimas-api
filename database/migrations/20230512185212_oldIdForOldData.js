exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.integer('oldId');
  });
  await knex.schema.alterTable('fishBatches', (table) => {
    table.integer('oldId');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('oldId');
  });
  await knex.schema.alterTable('fishBatches', (table) => {
    table.dropColumn('oldId');
  });
};
