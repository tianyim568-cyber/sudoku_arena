// Quick DB inspector — PostgreSQL version.
// Prints row counts and a small sample for each table.
// Run from the server/ directory: node check-db.js
require('dotenv').config();
const { createPostgresConnection, closeConnection } = require('./src/db/connection');

const TABLES = [
  'users', 'tournaments', 'rounds', 'teams', 'puzzles', 'puzzle_relations',
  'team_members', 'tournament_judges', 'player_round_states',
  'player_puzzle_assignments', 'submissions', 'scores', 'team_puzzle_sets',
];

async function main() {
  let conn;
  try {
    conn = await createPostgresConnection();
  } catch (e) {
    console.error('Could not connect to PostgreSQL:', e.message);
    console.error('Make sure the database is running and server/.env is configured.');
    process.exit(1);
  }
  const { all } = conn;

  console.log('=== Database Report (PostgreSQL) ===\n');

  for (const table of TABLES) {
    try {
      const countRows = await all(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const n = countRows[0] ? countRows[0].n : 0;
      if (n > 0) {
        console.log(`[${table}] ${n} rows`);
        const rows = await all(`SELECT * FROM ${table} LIMIT 5`);
        if (rows.length > 0) {
          console.log('  Columns:', Object.keys(rows[0]).join(', '));
          rows.forEach(r => console.log(' ', Object.values(r)));
        }
        console.log();
      }
    } catch (e) {
      console.log(`[${table}] (skipped: ${e.message})`);
    }
  }

  await closeConnection();
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  try { await closeConnection(); } catch (_) {}
  process.exit(1);
});
