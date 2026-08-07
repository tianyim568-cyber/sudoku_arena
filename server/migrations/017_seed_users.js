/**
 * Migration 017 — Seed default users.
 *
 * Creates the default admin, judge, and player accounts only if the users
 * table is empty. This replaces the inline _seedUsers() function from the
 * old db.js initialization.
 *
 * Passwords are bcrypt-hashed with 10 rounds, matching the original behavior.
 */

const bcrypt = require('bcryptjs');
const { escapeValue } = require('node-pg-migrate');

exports.up = async (pgm) => {
  // Only seed if no users exist yet (use pgm.db.select to get rows)
  const result = await pgm.db.select('SELECT COUNT(*) AS cnt FROM users');
  const count = parseInt(result[0].cnt, 10);
  if (count > 0) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const seeds = [
    { username: 'admin',   password: hash('admin123'),  role: 'ADMIN',  display_name: '管理员'  },
    { username: 'judge',   password: hash('judge123'),  role: 'JUDGE',  display_name: '裁判'    },
  ];
  for (let i = 1; i <= 8; i++) {
    seeds.push({
      username: `player${i}`,
      password: hash('player123'),
      role: 'PLAYER',
      display_name: `选手${i}`,
    });
  }

  for (const s of seeds) {
    pgm.sql(
      `INSERT INTO users (username, password, role, display_name) VALUES (${escapeValue(s.username)}, ${escapeValue(s.password)}, ${escapeValue(s.role)}, ${escapeValue(s.display_name)})`
    );
  }

  console.log('Seed users created via migration 017');
};

exports.down = (pgm) => {
  // Remove only the seeded users by their known usernames
  pgm.sql(`DELETE FROM users WHERE username IN ('admin','judge','player1','player2','player3','player4','player5','player6','player7','player8')`);
};
