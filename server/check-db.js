// Quick DB inspector
// Run: node check-db.js

const SQL = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/sudoku.db');

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('No database file found at:', DB_PATH);
    console.log('Run "node src/index.js" to start the server and create one.');
    return;
  }

  const sql = await SQL();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new sql.Database(buffer);

  const tables = [
    'users', 'tournaments', 'rounds', 'puzzles',
    'teams', 'team_members', 'tournament_judges',
    'player_round_states', 'player_puzzle_assignments',
    'submissions', 'scores'
  ];

  console.log('=== Database Report ===\n');

  for (const table of tables) {
    const count = db.exec(`SELECT COUNT(*) FROM ${table}`);
    const n = count[0]?.values[0]?.[0] || 0;
    if (n > 0) {
      console.log(`[${table}] ${n} rows`);
      const rows = db.exec(`SELECT * FROM ${table} LIMIT 5`);
      if (rows[0]) {
        console.log('  Columns:', rows[0].columns.join(', '));
        rows[0].values.forEach(v => console.log(' ', v));
      }
      console.log();
    }
  }

  db.close();
}

main().catch(console.error);
