/**
 * Migration 039: Remove email column from users table
 */

exports.up = (pgm) => {
  pgm.dropColumn('users', 'email');
};

exports.down = (pgm) => {
  pgm.addColumn('users', {
    email: {
      type: 'varchar(255)',
      notNull: false,
    },
  });
};
