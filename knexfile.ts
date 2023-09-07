const { knexSnakeCaseMappers } = require('objection');
require('dotenv').config();

// Update with your config settings.

const config = {
  client: 'pg',
  connection: process.env.DB_CONNECTION,
  migrations: {
    tableName: 'migrations',
    directory: './database/migrations',
  },
  pool: { min: 0, max: 10 },
  ...knexSnakeCaseMappers(),
};

module.exports = config;
