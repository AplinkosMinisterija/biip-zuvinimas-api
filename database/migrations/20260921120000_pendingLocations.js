const { commonFields } = require('./20230405144107_setup');

exports.up = async function (knex) {
  // btree_gist lets an exclusion constraint mix an equality test on text with
  // a bounding-box overlap test on geometry.
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

  await knex.schema.createTable('pendingLocations', (table) => {
    table.increments('id');
    table.string('name', 255).notNullable();
    // Reserved namespace NR-######; minted on approval, never null afterwards.
    table.string('cadastralId', 32).unique();
    // The real UETK id, once AAA registers the object. Marks the row retired.
    table.string('uetkCadastralId', 32);
    table
      .enu('status', ['REQUESTED', 'APPROVED', 'REJECTED', 'REGISTERED_IN_UETK'])
      .notNullable()
      .defaultTo('REQUESTED');
    table.specificType('grpkTopIds', 'text[]');
    table.integer('grpkLayer');
    table.jsonb('municipality');
    commonFields(table);
  });

  await knex.raw(
    `ALTER TABLE pending_locations ADD COLUMN geom geometry(Geometry, 3346) NOT NULL`,
  );
  await knex.raw(`CREATE INDEX pending_locations_geom_idx ON pending_locations USING gist (geom)`);

  // One live row per real-world water body: a second row with the same name
  // whose bounding box overlaps an existing live row is rejected outright.
  // Two genuinely different "Naikupė" rivers do not overlap, so both stay legal.
  await knex.raw(`
    ALTER TABLE pending_locations
      ADD CONSTRAINT pending_locations_no_overlap
      EXCLUDE USING gist (lower(name) WITH =, geom WITH &&)
      WHERE (status IN ('REQUESTED', 'APPROVED') AND deleted_at IS NULL)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTable('pendingLocations');
};
