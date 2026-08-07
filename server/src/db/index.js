/**
 * Database repository factory.
 * Creates all repositories backed by a single database connection.
 *
 * Active repositories: users, players, categories (updated for current schema)
 * Deprecated repositories: kept as require-only for reference, NOT instantiated
 * (they reference tables dropped in migration 018 or renamed in migrations 037-045).
 *
 * Usage:
 *   const { createRepositoryFactory } = require('./db');
 *   const repos = createRepositoryFactory(dbConnection);
 *   await repos.users.findById(uuid);
 *   await repos.players.findByCompetition(competitionId);
 *   await repos.categories.findAll();
 */

const UserRepository = require('./repositories/UserRepository');
const PlayerRepository = require('./repositories/PlayerRepository');
const CategoryRepository = require('./repositories/CategoryRepository');

function createRepositoryFactory(dbConnection) {
  const { run, all, get, saveDB, transaction } = dbConnection;

  const db = { run, all, get, transaction };

  return {
    // Active repositories (current schema)
    users: new UserRepository(db),
    players: new PlayerRepository(db),
    categories: new CategoryRepository(db),

    // Expose saveDB as no-op for backward compatibility (PG auto-commits)
    saveDB: saveDB || (() => {}),
  };
}

module.exports = { createRepositoryFactory };
