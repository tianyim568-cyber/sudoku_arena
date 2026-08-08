/**
 * Migration 046 — Add competition_access_code to competitions table.
 *
 * Adds a unique, URL-safe access code used for competition entry links.
 * The code is generated server-side and stored in competitions.competition_access_code.
 * Format: 8-character alphanumeric slug (e.g. "a3f9b2c1").
 */

exports.up = (pgm) => {
  pgm.addColumns('competitions', {
    competition_access_code: {
      type: 'varchar(20)',
      notNull: false,
      unique: true,
    },
  });

  pgm.createIndex('competitions', 'competition_access_code', { unique: true });
};

exports.down = (pgm) => {
  pgm.dropIndex('competitions', 'competition_access_code');
  pgm.dropColumns('competitions', ['competition_access_code']);
};
