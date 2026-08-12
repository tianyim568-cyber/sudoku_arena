/**
 * Migration 036 — Seed default users (UUID version).
 *
 * Creates the default admin, judge, and player accounts only if the users
 * table is empty. Passwords are bcrypt-hashed with 10 rounds.
 *
 * Note: This replaces migration 017 which seeded users for the old SERIAL schema.
 */

const bcrypt = require('bcryptjs');
const { escapeValue } = require('node-pg-migrate');

exports.up = async (pgm) => {
  // Only seed if no users exist yet
  const result = await pgm.db.select('SELECT COUNT(*) AS cnt FROM users');
  const count = parseInt(result[0].cnt, 10);
  if (count > 0) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  // Create a default organization first
  const orgResult = await pgm.db.select(
    `INSERT INTO organizations (name, status)
     VALUES ('Default Organization', 'ACTIVE')
     RETURNING id`
  );
  const orgId = orgResult[0].id;

  const seeds = [
    { username: 'admin', password: hash('admin123'), role: 'SUPER_ADMIN' },
    { username: 'judge', password: hash('judge123'), role: 'JUDGE' },
  ];

  for (let i = 1; i <= 8; i++) {
    seeds.push({
      username: `player${i}`,
      password: hash('player123'),
      role: 'PLAYER',
    });
  }

  for (const s of seeds) {
    pgm.sql(
      `INSERT INTO users (organization_id, username, password_hash, role, status)
       VALUES (${escapeValue(orgId)}, ${escapeValue(s.username)}, ${escapeValue(s.password)}, ${escapeValue(s.role)}, 'ACTIVE')`
    );
  }

  console.log('Seed users created via migration 036 (UUID version)');
};

exports.down = (pgm) => {
  // Remove only the seeded users by their known usernames
  pgm.sql(`DELETE FROM users WHERE username IN ('admin','judge','player1','player2','player3','player4','player5','player6','player7','player8')`);
};
