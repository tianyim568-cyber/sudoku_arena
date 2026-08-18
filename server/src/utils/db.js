/**
 * Database initialization — PostgreSQL + Prisma ORM.
 * Delegates to db/connection.js for the raw PG connection (used by node-pg-migrate
 * and tenantGuard for dynamic SQL), and db/index.js for the repository factory
 * (now backed by Prisma Client).
 *
 * Schema management is handled by node-pg-migrate.
 * ORM queries are handled by Prisma Client.
 * On startup, pending migrations are automatically applied.
 */

const path = require('path');
const { runner } = require('node-pg-migrate');
const { createPostgresConnection } = require('../db/connection');
const { getPrisma } = require('../db/prisma');
const { createRepositoryFactory } = require('../db/index');
const logger = require('./logger');

let _helpers = null;
let _repos = null;

async function initDB() {
  if (_helpers) return _helpers;

  // 1. Create raw PG connection (used by node-pg-migrate and raw SQL queries)
  const connection = await createPostgresConnection();

  // 2. Automatically run pending migrations via node-pg-migrate
  await _runMigrations(connection);

  // 3. Initialize Prisma Client (used by repositories for ORM queries)
  const prisma = getPrisma();

  _helpers = {
    db: connection.db,
    run: connection.run,
    all: connection.all,
    get: connection.get,
    saveDB: connection.saveDB,
    transaction: connection.transaction,
    prisma,
  };
  _repos = createRepositoryFactory(prisma);

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

  logger.info('Running pending migrations...');
  await runner({
    databaseUrl,
    migrationsTable: 'pgmigrations',
    dir: migrationsDir,
    direction: 'up',
    count: Infinity,
    verbose: false,
  });
  logger.info('Migrations complete.');
}

function getHelpers() {
  return _helpers;
}

function getRepos() {
  return _repos;
}

module.exports = { initDB, getHelpers, getRepos };
