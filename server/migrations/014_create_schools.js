/**
 * Migration 014 — Create schools table.
 *
 * Participant import: schools with geographic info.
 * Has a UNIQUE constraint on (name, province, city, district).
 */

exports.up = (pgm) => {
  pgm.createTable('schools', {
    id:         { type: 'serial',  primaryKey: true },
    name:       { type: 'text',    notNull: true },
    province:   { type: 'text' },
    city:       { type: 'text' },
    district:   { type: 'text' },
    created_at: { type: 'text',    default: pgm.func('NOW()') },
  });

  pgm.addConstraint('schools', 'schools_name_location_unique', {
    unique: ['name', 'province', 'city', 'district'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('schools');
};
