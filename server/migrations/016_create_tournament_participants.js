/**
 * Migration 016 — Create tournament_participants table.
 *
 * Links participants to tournaments, with optional team assignment.
 * Has a UNIQUE constraint on (tournament_id, participant_id).
 */

exports.up = (pgm) => {
  pgm.createTable('tournament_participants', {
    id:              { type: 'serial',  primaryKey: true },
    tournament_id:   { type: 'integer', notNull: true, references: 'tournaments(id)' },
    participant_id:  { type: 'integer', notNull: true, references: 'participants(id)' },
    team_name:       { type: 'text' },
    team_id:         { type: 'integer', references: 'teams(id)' },
    imported_at:     { type: 'text',    default: pgm.func('NOW()') },
  });

  pgm.addConstraint('tournament_participants', 'tournament_participants_tournament_participant_unique', {
    unique: ['tournament_id', 'participant_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('tournament_participants');
};
