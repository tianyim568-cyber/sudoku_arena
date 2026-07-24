/**
 * Database connection factory — PostgreSQL via node-postgres (pg).
 *
 * Exposes the same uniform interface as the old sql.js version:
 *   { db, run, all, get, saveDB, transaction }
 *
 * All methods are now async. The `?` placeholder style used by
 * repositories is auto-converted to PostgreSQL `$1, $2, …` numbering
 * so that repository SQL strings never need to change.
 */

const { Pool } = require('pg');
const config = require('../config');

let _pool = null;

/**
 * Convert `?` placeholders to `$1, $2, …` numbered params.
 * Repos use `?` style; PG requires numbered params.
 */
function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function _run(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  try {
    await _pool.query(pgSql, params);
  } catch (e) {
    console.error('SQL Error:', pgSql, e.message);
    throw e;
  }
}

async function _all(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  try {
    const { rows } = await _pool.query(pgSql, params);
    return rows;
  } catch (e) {
    console.error('SQL Error:', pgSql, e.message);
    throw e;
  }
}

async function _get(sql, params = []) {
  const rows = await _all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** No-op — PG auto-commits each statement. */
function _saveDB() {}

/**
 * Run multiple operations in a database transaction.
 * @param {Function} fn - async callback receiving { run, all, get }
 */
async function _transaction(fn) {
  const client = await _pool.connect();
  try {
    await client.query('BEGIN');
    // Provide transaction-scoped run/all/get that use the client
    const tRun = async (sql, params = []) => {
      const pgSql = convertPlaceholders(sql);
      await client.query(pgSql, params);
    };
    const tAll = async (sql, params = []) => {
      const pgSql = convertPlaceholders(sql);
      const { rows } = await client.query(pgSql, params);
      return rows;
    };
    const tGet = async (sql, params = []) => {
      const rows = await tAll(sql, params);
      return rows.length > 0 ? rows[0] : null;
    };
    const result = await fn({ run: tRun, all: tAll, get: tGet });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Create a PostgreSQL connection pool.
 * Supports both DATABASE_URL (Render standard) and individual PG_* env vars.
 * @returns {Promise<{db: Pool, run: Function, all: Function, get: Function, saveDB: Function, transaction: Function}>}
 */
async function createPostgresConnection() {
  if (_pool) {
    return { db: _pool, run: _run, all: _all, get: _get, saveDB: _saveDB, transaction: _transaction };
  }

  // Build PG config from env vars
  let poolConfig;
  if (config.DATABASE_URL) {
    poolConfig = {
      connectionString: config.DATABASE_URL,
      ssl: config.PG_SSL ? { rejectUnauthorized: false } : undefined,
    };
  } else {
    poolConfig = {
      host: config.PG_HOST,
      port: config.PG_PORT,
      database: config.PG_DATABASE,
      user: config.PG_USER,
      password: config.PG_PASSWORD,
      ssl: config.PG_SSL ? { rejectUnauthorized: false } : undefined,
    };
  }

  _pool = new Pool(poolConfig);

  // Verify connection
  try {
    const client = await _pool.connect();
    console.log('PostgreSQL connected successfully');
    client.release();
  } catch (e) {
    console.error('PostgreSQL connection failed:', e.message);
    throw e;
  }

  // Handle pool-level errors
  _pool.on('error', (err) => {
    console.error('Unexpected PG pool error:', err.message);
  });

  return { db: _pool, run: _run, all: _all, get: _get, saveDB: _saveDB, transaction: _transaction };
}

/**
 * Get existing connection helpers.
 */
function getConnection() {
  if (!_pool) throw new Error('Database not initialized. Call createPostgresConnection first.');
  return { db: _pool, run: _run, all: _all, get: _get, saveDB: _saveDB, transaction: _transaction };
}

/**
 * Gracefully shut down the pool (for process exit).
 */
async function closeConnection() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

module.exports = { createPostgresConnection, getConnection, closeConnection };
