/**
 * Migration 048 — Add display_mode to competitions table.
 *
 * Big-screen display mode selector. The judge picks a mode from the control
 * panel; DisplayPage reads it from the snapshot and renders the matching view.
 *
 * Supported modes: DEFAULT, LIVE_RANKING, PLAYER_BROADCAST, ROUND_RANKING,
 * FINAL_RANKING, STAGE_RANKING.
 */

exports.up = (pgm) => {
  pgm.addColumns('competitions', {
    display_mode: {
      type: 'varchar(50)',
      notNull: true,
      default: 'DEFAULT',
    },
  });

  pgm.sql(`COMMENT ON COLUMN competitions.display_mode IS 'Big-screen display mode: DEFAULT, LIVE_RANKING, PLAYER_BROADCAST, ROUND_RANKING, FINAL_RANKING'`);
};

exports.down = (pgm) => {
  pgm.dropColumns('competitions', ['display_mode']);
};
