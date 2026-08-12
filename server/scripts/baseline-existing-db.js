/**
 * baseline-existing-db.js
 *
 * Baseline script for adopting node-pg-migrate on an existing database.
 *
 * This script marks all 017 existing migrations as "already run" in the
 * pgmigrations table, so the migration system knows the database already
 * has the current schema. It does NOT modify any existing tables or data.
 *
 * Run this ONCE on the existing production/development database:
 *   node scripts/baseline-existing-db.js
 *
 * After baselining, `npm run migrate:up` will report "No migrations to run"
 * until new migrations are added.
 */

require('dotenv').config();
const { Pool } = require('pg');

const MIGRATIONS = [
  '001_create_users',
  '002_create_tournaments',
  '003_create_rounds',
  '004_create_teams',
  '005_create_puzzles',
  '006_create_puzzle_relations',
  '007_create_team_members',
  '008_create_tournament_judges',
  '009_create_player_round_states',
  '010_create_player_puzzle_assignments',
  '011_create_submissions',
  '012_create_scores',
  '013_create_team_puzzle_sets',
  '014_create_schools',
  '015_create_participants',
  '016_create_tournament_participants',
  '017_seed_users',
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('=== Baseline existing database for node-pg-migrate ===\n');

  // Verify the existing tables exist
  const tablesCheck = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  const tableNames = tablesCheck.rows.map((r) => r.table_name);
  console.log('Existing tables:', tableNames.join(', '));

  const requiredTables = [
    'users', 'tournaments', 'rounds', 'teams', 'puzzles',
    'puzzle_relations', 'team_members', 'tournament_judges',
    'player_round_states', 'player_puzzle_assignments',
    'submissions', 'scores', 'team_puzzle_sets', 'schools',
    'participants', 'tournament_participants',
  ];
  const missing = requiredTables.filter((t) => !tableNames.includes(t));
  if (missing.length > 0) {
    console.error('\nERROR: Missing required tables:', missing.join(', '));
    console.error('This database does not have the expected schema. Do NOT run baselining.');
    await pool.end();
    process.exit(1);
  }

  // Check if pgmigrations already exists and has entries
  const pgmExists = tableNames.includes('pgmigrations');
  if (!pgmExists) {
    console.log('\nCreating pgmigrations table...');
    await pool.query(`
      CREATE TABLE pgmigrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        run_on TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
  } else {
    const existing = await pool.query('SELECT name FROM pgmigrations ORDER BY id');
    if (existing.rows.length > 0) {
      console.log('\npgmigrations already has', existing.rows.length, 'entries.');
      console.log('Existing:', existing.rows.map((r) => r.name).join(', '));
      console.log('\nIf you want to re-baseline, clear the pgmigrations table first:');
      console.log('  DELETE FROM pgmigrations;');
      await pool.end();
      process.exit(0);
    }
  }

  // Insert baseline records
  console.log('\nInserting baseline migration records...');
  for (const name of MIGRATIONS) {
    await pool.query(
      'INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())',
      [name]
    );
    console.log('  Marked as run:', name);
  }

  console.log('\nBaseline complete! The migration system now recognizes this database');
  console.log('as having all existing migrations applied.');
  console.log('\nRun `npm run migrate:up` to verify — it should report "No migrations to run".');

  await pool.end();
}

main().catch((err) => {
  console.error('Baseline failed:', err.message);
  process.exit(1);
});
