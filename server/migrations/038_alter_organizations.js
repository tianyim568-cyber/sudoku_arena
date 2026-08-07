/**
 * Migration 038: Remove description column from organizations table
 */

exports.up = (pgm) => {
  pgm.dropColumn('organizations', 'description');
};

exports.down = (pgm) => {
  pgm.addColumn('organizations', {
    description: {
      type: 'text',
      notNull: false,
    },
  });
};
