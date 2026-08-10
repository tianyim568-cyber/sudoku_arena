/**
 * Migration 047 — Add preparation_seconds to rounds table.
 *
 * Adds a countdown duration for the preparation phase before gameplay starts.
 * Admin sets this when configuring a round. Default is 10 seconds.
 */

exports.up = (pgm) => {
  pgm.addColumns('rounds', {
    preparation_seconds: {
      type: 'integer',
      notNull: true,
      default: 10,
    },
  });

  pgm.sql(`COMMENT ON COLUMN rounds.preparation_seconds IS 'Countdown duration before round starts gameplay (preparation phase)'`);
};

exports.down = (pgm) => {
  pgm.dropColumns('rounds', ['preparation_seconds']);
};
