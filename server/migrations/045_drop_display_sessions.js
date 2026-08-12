/**
 * Migration 045: Drop display_sessions table
 */

exports.up = (pgm) => {
  pgm.dropTable('display_sessions');
};

exports.down = (pgm) => {
  pgm.createTable('display_sessions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    competition_id: {
      type: 'uuid',
      notNull: true,
      references: 'competitions(id)',
    },
    token: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    current_mode: {
      type: 'varchar(50)',
      notNull: true,
      default: 'DEFAULT',
    },
    selected_player_id: {
      type: 'uuid',
      notNull: false,
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};
