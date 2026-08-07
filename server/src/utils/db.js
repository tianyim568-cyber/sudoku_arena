/**
 * Database initialization — PostgreSQL version.
 * Delegates to db/connection.js for the actual connection,
 * and db/index.js for the repository factory.
 *
 * Schema management is handled by node-pg-migrate.
 * On startup, pending migrations are automatically applied.
 */

const path = require('path');
const { runner } = require('node-pg-migrate');
const { createPostgresConnection } = require('../db/connection');
const { createRepositoryFactory } = require('../db/index');

let _helpers = null;
let _repos = null;

async function initDB() {
  if (_helpers) return _helpers;

  const connection = await createPostgresConnection();

  // Automatically run pending migrations
  await _runMigrations(connection);

  _helpers = { db: connection.db, run: connection.run, all: connection.all, get: connection.get, saveDB: connection.saveDB, transaction: connection.transaction };
  _repos = createRepositoryFactory(connection);

  return _helpers;
}

/**
 * Run pending migrations using node-pg-migrate's programmatic API.
 * This ensures the database schema is always up-to-date on startup.
 */
async function _runMigrations(connection) {
  const config = require('../config');

  // Build database URL or connection object
  let databaseUrl;
  if (config.DATABASE_URL) {
    databaseUrl = config.DATABASE_URL;
  } else {
    databaseUrl = {
      host: config.PG_HOST,
      port: config.PG_PORT,
      database: config.PG_DATABASE,
      user: config.PG_USER,
      password: config.PG_PASSWORD,
    };
  }

  const migrationsDir = path.join(__dirname, '../../migrations');

  console.log('Running pending migrations...');
  await runner({
    databaseUrl,
    migrationsTable: 'pgmigrations',
    dir: migrationsDir,
    direction: 'up',
    count: Infinity,
    verbose: false,
  });
  console.log('Migrations complete.');
}

function getHelpers() {
  return _helpers;
}

function getRepos() {
  return _repos;
}

module.exports = { initDB, getHelpers, getRepos };
