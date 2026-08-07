/**
 * Migration 030 — Create team_members junction table (UUID version).
 *
 * Associates participants with teams. Composite primary key ensures
 * a participant can only be in one team per competition.
 */

exports.up = (pgm) => {
  pgm.createTable('team_members', {
    team_id:        { type: 'uuid', notNull: true, references: 'teams(id)', onDelete: 'CASCADE' },
    participant_id: { type: 'uuid', notNull: true, references: 'participants(id)', onDelete: 'CASCADE' },
  });

  pgm.addConstraint('team_members', 'team_members_pkey', {
    primaryKey: ['team_id', 'participant_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('team_members');
};
