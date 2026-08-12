/**
 * Database repository factory.
 * Creates all repositories backed by a Prisma Client instance.
 *
 * Active repositories: users, players, categories (now using Prisma ORM)
 * Deprecated repositories: kept as require-only for reference, NOT instantiated
 * (they reference tables dropped in migration 018 or renamed in migrations 037-045).
 *
 * Usage:
 *   const { createRepositoryFactory } = require('./db');
 *   const repos = createRepositoryFactory(prisma);
 *   await repos.users.findById(uuid);
 *   await repos.players.findByCompetition(competitionId);
 *   await repos.categories.findAll();
 */

const UserRepository = require('./repositories/UserRepository');
const PlayerRepository = require('./repositories/PlayerRepository');
const CategoryRepository = require('./repositories/CategoryRepository');
const OrganizationRepository = require('./repositories/OrganizationRepository');

function createRepositoryFactory(prisma) {
  return {
    // Active repositories (now using Prisma ORM)
    users: new UserRepository(prisma),
    players: new PlayerRepository(prisma),
    categories: new CategoryRepository(prisma),
    organizations: new OrganizationRepository(prisma),

    // Expose saveDB as no-op for backward compatibility
    saveDB: () => {},
  };
}

module.exports = { createRepositoryFactory };
