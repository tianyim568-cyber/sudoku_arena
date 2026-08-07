/**
 * Migration 011 — Create submissions table.
 *
 * Records each player's puzzle submission, including correctness and points earned.
 */

exports.up = (pgm) => {
  pgm.createTable('submissions', {
    id:               { type: 'serial',  primaryKey: true },
    round_id:         { type: 'integer', notNull: true, references: 'rounds(id)' },
    player_id:        { type: 'integer', notNull: true, references: 'users(id)' },
    puzzle_id:        { type: 'integer', notNull: true, references: 'puzzles(id)' },
    team_id:          { type: 'integer', references: 'teams(id)' },
    submission_type:  { type: 'text',    notNull: true },
    submitted_value:  { type: 'text' },
    is_correct:       { type: 'integer', notNull: true },
    points_earned:    { type: 'integer', notNull: true, default: 0 },
    submitted_at:     { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('submissions');
};
