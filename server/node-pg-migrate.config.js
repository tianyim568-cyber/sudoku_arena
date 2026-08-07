/**
 * node-pg-migrate configuration
 *
 * Reuses the existing database configuration from environment variables.
 * Supports both DATABASE_URL and individual PG_* variables.
 *
 * Usage:
 *   npm run migrate:up      # Run all pending migrations
 *   npm run migrate:down    # Rollback the last migration
 *   npm run migrate:redo    # Rollback and re-run the last migration
 *   npm run migrate:create  # Create a new migration file
 */

require('dotenv').config();

module.exports = {
  // Database connection
  databaseUrl: process.env.DATABASE_URL || {
    host: process.env.PG_HOST || process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PG_PORT || process.env.PGPORT || '5432', 10),
    database: process.env.PG_DATABASE || process.env.PGDATABASE || 'sudoku_arena',
    user: process.env.PG_USER || process.env.PGUSER || 'postgres',
    password: process.env.PG_PASSWORD || process.env.PGPASSWORD || '',
  },

  // SSL configuration
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,

  // Migration settings
  dir: 'migrations',
  direction: 'up',
  schema: 'public',
  createSchema: false,
  migrationsSchema: 'public',
  createMigrationsSchema: false,
  migrationsTable: 'pgmigrations',
  noLock: false,
  verbose: true,

  // Filename format
  migrationFilenameFormat: 'utc',
  migrationFileLanguage: 'js',
};
