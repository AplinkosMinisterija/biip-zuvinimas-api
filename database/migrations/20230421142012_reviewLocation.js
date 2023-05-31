exports.up = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('reviewLocation');
  });
  await knex.schema.raw(
    `ALTER TABLE fish_stockings ADD COLUMN review_location geometry(point, 3346)`,
  );
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fishStockings', (table) => {
    table.dropColumn('reviewLocation');
  });
  await knex.schema.alterTable('fishStockings', (table) => {
    table.jsonb('reviewLocation');
  });
};
