/**
 * Migration 018 — Enable UUID extension and drop legacy tables.
 *
 * This migration transitions from the old SERIAL-based schema to the new
 * UUID-based multi-tenant SaaS schema defined in DEVELOPMENT_PLAN.md.
 *
 * Actions:
 * 1. Enable uuid-ossp PostgreSQL extension for UUID generation
 * 2. Drop all legacy tables that are replaced by the new schema
 *
 * Tables dropped (12):
 * - tournament_participants (merged into participants.competition_id)
 * - tournament_judges (replaced by competition_judges)
 * - team_puzzle_sets (replaced by round_puzzles)
 * - scores (replaced by round_rankings + final_rankings)
 * - submissions (replaced by puzzle_answers)
 * - player_puzzle_assignments (replaced by player_round_sessions + puzzle_answers)
 * - player_round_states (replaced by player_round_sessions)
 * - puzzle_relations (no longer needed in new schema)
 * - schools (replaced by participants.school/province)
 * - participants (will be recreated with UUID)
 * - puzzles (will be recreated with UUID + JSONB)
 * - team_members (will be recreated with UUID)
 * - teams (will be recreated with UUID)
 * - rounds (will be recreated with UUID + stage_id)
 * - tournaments (replaced by competitions)
 * - users (will be recreated with UUID)
 *
 * WARNING: This is a destructive migration. All data in the above tables
 * will be lost. Ensure data is backed up before running on production.
 */

exports.up = (pgm) => {
  // Enable UUID extension
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Drop all legacy tables with CASCADE to handle FK dependencies
  const legacyTables = [
    'tournament_participants', 'tournament_judges', 'team_puzzle_sets',
    'scores', 'submissions', 'player_puzzle_assignments',
    'player_round_states', 'puzzle_relations', 'schools',
    'participants', 'puzzles', 'team_members', 'teams',
    'rounds', 'tournaments', 'users',
  ];
  for (const table of legacyTables) {
    pgm.sql(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }

  console.log('Legacy tables dropped. UUID extension enabled.');
};

exports.down = (pgm) => {
  // Note: We cannot recreate the exact legacy schema here because
  // the old migrations (001-017) already define it. If you need to
  // rollback, use: npm run migrate:down (which will undo this migration
  // and then you can re-run 001-017).

  console.warn('Migration 018 rollback: Legacy tables must be restored by re-running migrations 001-017');

  // Disable UUID extension (only if safe)
  pgm.sql('DROP EXTENSION IF EXISTS "uuid-ossp"');
};
