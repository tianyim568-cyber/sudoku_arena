/**
 * Database initialization — PostgreSQL version.
 * Delegates to db/connection.js for the actual connection,
 * and db/index.js for the repository factory.
 */

const bcrypt = require('bcryptjs');
const { createPostgresConnection } = require('../db/connection');
const { createRepositoryFactory } = require('../db/index');

let _helpers = null;
let _repos = null;

async function initDB() {
  if (_helpers) return _helpers;

  const connection = await createPostgresConnection();

  // Run schema creation (now async)
  await _runSchema(connection);

  // Seed users (now async)
  await _seedUsers(connection);

  // No saveDB needed — PG auto-commits

  _helpers = { db: connection.db, run: connection.run, all: connection.all, get: connection.get, saveDB: connection.saveDB, transaction: connection.transaction };
  _repos = createRepositoryFactory(connection);

  return _helpers;
}

function getHelpers() {
  return _helpers;
}

function getRepos() {
  return _repos;
}

async function _runSchema({ run }) {
  // Use SERIAL PRIMARY KEY instead of INTEGER PRIMARY KEY AUTOINCREMENT
  // Use NOW() instead of datetime('now')
  // PG handles DEFAULT timestamps natively

  await run(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tournaments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    scheduled_time TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT NOW(),
    updated_at TEXT DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    round_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    round_type TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED',
    remaining_seconds INTEGER,
    started_at TEXT,
    ended_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    name TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS puzzles (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    puzzle_type TEXT NOT NULL,
    order_in_round INTEGER NOT NULL,
    initial_grid TEXT NOT NULL,
    solution TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 100,
    letter TEXT,
    metadata TEXT,
    difficulty TEXT,
    team_id INTEGER REFERENCES teams(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS puzzle_relations (
    id SERIAL PRIMARY KEY,
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    related_puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    relation_type TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id),
    player_id INTEGER NOT NULL REFERENCES users(id),
    position INTEGER,
    joined_at TEXT DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tournament_judges (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    judge_id INTEGER NOT NULL REFERENCES users(id),
    assigned_at TEXT DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS player_round_states (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES users(id),
    team_id INTEGER REFERENCES teams(id),
    status TEXT NOT NULL DEFAULT 'WAITING'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS player_puzzle_assignments (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES users(id),
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    team_id INTEGER REFERENCES teams(id),
    assigned_at TEXT DEFAULT NOW(),
    current_grid TEXT,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES users(id),
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    team_id INTEGER REFERENCES teams(id),
    submission_type TEXT NOT NULL,
    submitted_value TEXT,
    is_correct INTEGER NOT NULL,
    points_earned INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER REFERENCES users(id),
    team_id INTEGER REFERENCES teams(id),
    score_type TEXT NOT NULL,
    total_points INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT NOW()
  )`);

  // Round 1: persistent team-puzzle assignment tracking
  await run(`CREATE TABLE IF NOT EXISTS team_puzzle_sets (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    word TEXT NOT NULL,
    puzzle_ids TEXT NOT NULL,
    assigned_at TEXT DEFAULT NOW(),
    UNIQUE(round_id, team_id)
  )`);
}

async function _seedUsers({ get, run }) {
  const existing = await get("SELECT COUNT(*) as cnt FROM users");
  if (parseInt(existing.cnt) === 0) {
    const hash = (pw) => bcrypt.hashSync(pw, 10);
    await run("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)", ['admin', hash('admin123'), 'ADMIN', '管理员']);
    await run("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)", ['judge', hash('judge123'), 'JUDGE', '裁判']);
    for (let i = 1; i <= 8; i++) {
      await run("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)", [`player${i}`, hash('player123'), 'PLAYER', `选手${i}`]);
    }
    console.log('Seed users created');
  }
}

module.exports = { initDB, getHelpers, getRepos };
