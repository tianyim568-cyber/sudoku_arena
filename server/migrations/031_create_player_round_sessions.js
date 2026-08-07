/**
 * Migration 031 — Create player_round_sessions table.
 *
 * Tracks each participant's session within a round. Stores timing and
 * submission status. One session per participant per round.
 *
 * Status: WAITING, PLAYING, SUBMITTED, AUTO_SUBMITTED
 */

exports.up = (pgm) => {
  pgm.createTable('player_round_sessions', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    round_id:       { type: 'uuid', notNull: true, references: 'rounds(id)' },
    participant_id: { type: 'uuid', notNull: true, references: 'participants(id)' },
    started_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    submitted_at:   { type: 'timestamptz' },
    status:         { type: 'varchar(50)', notNull: true, default: 'WAITING' },
  });

  pgm.addConstraint('player_round_sessions', 'player_round_sessions_round_participant_unique', {
    unique: ['round_id', 'participant_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('player_round_sessions');
};
