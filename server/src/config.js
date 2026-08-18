/**
 * Centralized configuration for the Sudoku Arena server.
 * Reads from environment variables with sensible defaults.
 */

const logger = require('./utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

// In production, require a strong JWT secret (no weak fallback). This is a
// fatal start-up failure: the server cannot run safely without it. logger.fatal
// logs the reason then exits — same behaviour as the old console.error + exit,
// but structured and consistent with the rest of the log output.
if (isProduction && !process.env.JWT_SECRET) {
  logger.fatal('JWT_SECRET must be set in production. Generate one with: openssl rand -base64 48');
}

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database — PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL || null,
  PG_HOST: process.env.PG_HOST || process.env.PGHOST || 'localhost',
  PG_PORT: parseInt(process.env.PG_PORT || process.env.PGPORT || '5432', 10),
  PG_DATABASE: process.env.PG_DATABASE || process.env.PGDATABASE || 'sudoku_arena',
  PG_USER: process.env.PG_USER || process.env.PGUSER || 'postgres',
  PG_PASSWORD: process.env.PG_PASSWORD || process.env.PGPASSWORD || '',
  PG_SSL: process.env.PG_SSL === 'true',

  // Redis (optional — falls back to in-memory if not set)
  REDIS_URL: process.env.REDIS_URL || null,

  // JWT — weak fallback only for development
  JWT_SECRET: process.env.JWT_SECRET || (isProduction ? null : 'sudoku-arena-dev-only-secret'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  // Game defaults
  ROUND2_ROTATION_INTERVAL_MS: 60000,
  HEARTBEAT_INTERVAL_MS: 30000,
  ACTIVE_PLAYER_TTL_S: 120,

  // WebSocket rate limiting (incoming messages per connection)
  WS_RATE_LIMIT: parseInt(process.env.WS_RATE_LIMIT || '10', 10), // max events per second

  // CORS
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','),

  // Frontend URL (for generating competition entry links)
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
};
