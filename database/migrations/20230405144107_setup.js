const commonFields = (table) => {
  table.timestamp('createdAt');
  table.integer('createdBy').unsigned();
  table.timestamp('updatedAt');
  table.integer('updatedBy').unsigned();
  table.timestamp('deletedAt');
  table.integer('deletedBy').unsigned();
};

exports.commonFields = commonFields;

exports.up = function (knex) {
  return knex.schema
    .createTable('users', (table) => {
      table.increments('id');
      table.integer('authUserId').unsigned();
      table.string('firstName', 255);
      table.string('lastName', 255);
      table.string('email', 255);
      table.string('phone', 255);
      table.timestamp('lastLogin');
      table.enu('type', ['USER', 'ADMIN']).defaultTo('USER');
      table.jsonb('tenants');
      commonFields(table);
    })
    .createTable('tenants', (table) => {
      table.increments('id');
      table.string('code');
      table.string('email');
      table.string('phone');
      table.string('name', 255);
      table.integer('authGroupId').unsigned();
      commonFields(table);
    })
    .createTable('tenantUsers', (table) => {
      table.increments('id');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      table.enu('role', ['USER', 'USER_ADMIN', 'OWNER']).defaultTo('USER');
      commonFields(table);
    })
    .createTable('fishTypes', (table) => {
      table.increments('id');
      table.string('label');
      commonFields(table);
    })
    .createTable('fishAges', (table) => {
      table.increments('id');
      table.string('label');
      commonFields(table);
    })
    .createTable('fishBatches', (table) => {
      table.increments('id');
      table.integer('fishTypeId').unsigned();
      table.integer('fishAgeId').unsigned();
      table.integer('amount');
      table.float('weight');
      table.integer('reviewAmount');
      table.float('reviewWeight');
      table.integer('fishStockingId').unsigned();
      commonFields(table);
    })
    .createTable('fishStockings', (table) => {
      table.increments('id');
      table.timestamp('eventTime');
      table.string('comment');
      table.integer('tenantId').unsigned();
      table.integer('stockingCustomerId').unsigned();
      table.string('fishOrigin');
      table.string('fishOriginCompanyName');
      table.jsonb('fishOriginReservoir');
      table.jsonb('location');
      table.integer('assignedToId').unsigned();
      table.string('phone');
      table.integer('reviewedById').unsigned();
      table.jsonb('reviewLocation');
      table.timestamp('reviewTime');
      table.string('waybillNo');
      table.string('veterinaryApprovalNo');
      table.string('veterinaryApprovalOrderNo');
      table.integer('containerWaterTemp');
      table.integer('waterTemp');
      table.jsonb('signatures');
      table.integer('assignedToInspectorId').unsigned();
      commonFields(table);
    })
    .createTable('fishStockingPhotos', (table) => {
      table.increments('id');
      table.string('name');
      table.integer('fishStockingId').unsigned();
      commonFields(table);
    })
    .createTable('settings', (table) => {
      table.increments('id');
      table.integer('minTimeTillFishStocking');
      table.integer('maxTimeForRegistration');
      commonFields(table);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('tenantUsers')
    .dropTable('tenants')
    .dropTable('users')
    .dropTable('fishTypes')
    .dropTable('fishAges')
    .dropTable('fishBatches')
    .dropTable('fishStockingPhotos')
    .dropTable('fishStockings');
};
