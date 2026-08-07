/**
 * Migration 035 — Create display_sessions table.
 *
 * Big-screen WebSocket display support. Each display session has a unique
 * token and can broadcast a specific player's screen or show rankings.
 *
 * current_mode: RANKING, PLAYER_SCREEN, DEFAULT
 */

exports.up = (pgm) => {
  pgm.createTable('display_sessions', {
    id:                 { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    competition_id:     { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    token:              { type: 'varchar(255)', notNull: true, unique: true },
    current_mode:       { type: 'varchar(50)', notNull: true, default: 'DEFAULT' },
    selected_player_id: { type: 'uuid' },
    updated_at:         { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('display_sessions');
};
