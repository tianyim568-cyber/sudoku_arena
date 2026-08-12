/**
 * Migration 040: Alter competitions table
 * - Drop access_code column
 * - Drop created_by column (and its FK)
 * - Rename entry_token to display_access_token
 */

exports.up = (pgm) => {
  // Drop unique constraint on access_code
  pgm.dropConstraint('competitions', 'competitions_org_access_code_unique');
  // Drop index on access_code
  pgm.dropIndex('competitions', 'access_code');
  // Drop access_code column
  pgm.dropColumn('competitions', 'access_code');
  // Drop created_by FK and column
  pgm.dropColumn('competitions', 'created_by');
  // Rename entry_token to display_access_token
  pgm.renameColumn('competitions', 'entry_token', 'display_access_token');
};

exports.down = (pgm) => {
  pgm.renameColumn('competitions', 'display_access_token', 'entry_token');
  pgm.addColumn('competitions', {
    created_by: {
      type: 'uuid',
      notNull: false,
      references: 'users(id)',
    },
  });
  pgm.addColumn('competitions', {
    access_code: {
      type: 'varchar(50)',
      notNull: false,
    },
  });
  pgm.addConstraint('competitions', 'competitions_org_access_code_unique', {
    unique: ['organization_id', 'access_code'],
  });
  pgm.createIndex('competitions', 'access_code');
};
