/**
 * Migration 033 — Create round_rankings table.
 *
 * Snapshot-based ranking per round. Computed after round completion using
 * completion-ratio algorithm from puzzle_answers.
 *
 * Replaces the old scores table with a simpler, pre-computed model.
 */

exports.up = (pgm) => {
  pgm.createTable('round_rankings', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    round_id:       { type: 'uuid', notNull: true, references: 'rounds(id)', onDelete: 'CASCADE' },
    participant_id: { type: 'uuid', references: 'participants(id)' },
    team_id:        { type: 'uuid', references: 'teams(id)' },
    score:          { type: 'integer', notNull: true, default: 0 },
    rank:           { type: 'integer' },
    calculated_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('round_rankings', 'round_id');
};

exports.down = (pgm) => {
  pgm.dropTable('round_rankings');
};
