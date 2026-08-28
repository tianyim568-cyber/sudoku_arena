/**
 * Migration 052 — Add city and district columns to players table.
 *
 * The Prisma schema (schema.prisma) already declared these columns on the
 * players model, and ParticipantRepository.js was already passing them on
 * import, but no migration ever added them to the actual database table.
 * After `prisma generate` rebuilt the client from the schema, queries
 * started including city/district — causing "column does not exist" errors.
 *
 * Both columns are optional (nullable varchar(100)), matching the schema.
 */

exports.up = (pgm) => {
  pgm.addColumn('players', {
    city: {
      type: 'varchar(100)',
      notNull: false,
    },
  });
  pgm.addColumn('players', {
    district: {
      type: 'varchar(100)',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('players', 'city');
  pgm.dropColumn('players', 'district');
};
