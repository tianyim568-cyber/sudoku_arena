/**
 * Migration 049 — Add broadcast_player_id to competitions table.
 *
 * When the judge spotlights a player on the big screen (PLAYER_BROADCAST mode),
 * this column stores the player ID being broadcast. NULL when not broadcasting.
 *
 * References players(id) but without a foreign key constraint — the display
 * manager handles cleanup when the player is deleted or the broadcast stops.
 */

exports.up = (pgm) => {
  pgm.addColumns('competitions', {
    broadcast_player_id: {
      type: 'uuid',
      notNull: false,
    },
  });

  pgm.sql(`COMMENT ON COLUMN competitions.broadcast_player_id IS 'Player ID currently spotlighted on big screen (NULL when not broadcasting)'`);
};

exports.down = (pgm) => {
  pgm.dropColumns('competitions', ['broadcast_player_id']);
};
