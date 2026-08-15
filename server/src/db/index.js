/**
 * Database repository factory.
 * Creates all repositories backed by a Prisma Client instance.
 *
 * All repositories use Prisma ORM against the new schema (migration 018+).
 * The repository keys mirror the new table names (repos.competitions,
 * repos.rounds, repos.teams, etc.) so the route layer reads naturally.
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
const CompetitionRepository = require('./repositories/CompetitionRepository');
const RoundRepository = require('./repositories/RoundRepository');
const TeamRepository = require('./repositories/TeamRepository');
const ParticipantRepository = require('./repositories/ParticipantRepository');
const ScoreRepository = require('./repositories/ScoreRepository');
const PuzzleRepository = require('./repositories/PuzzleRepository');
const PlayerStateRepository = require('./repositories/PlayerStateRepository');
const SubmissionRepository = require('./repositories/SubmissionRepository');
const TeamPuzzleSetRepository = require('./repositories/TeamPuzzleSetRepository');
const { RankingRepository } = require('./repositories/RankingRepository');

function createRepositoryFactory(prisma) {
  return {
    // Active repositories (Prisma ORM, new schema)
    users: new UserRepository(prisma),
    players: new PlayerRepository(prisma),
    categories: new CategoryRepository(prisma),
    organizations: new OrganizationRepository(prisma),
    competitions: new CompetitionRepository(prisma),
    rounds: new RoundRepository(prisma),
    teams: new TeamRepository(prisma),
    participants: new ParticipantRepository(prisma),
    scores: new ScoreRepository(prisma),
    puzzles: new PuzzleRepository(prisma),
    playerStates: new PlayerStateRepository(prisma),
    submissions: new SubmissionRepository(prisma),
    teamPuzzleSets: new TeamPuzzleSetRepository(prisma),
    rankings: new RankingRepository(),

    // Expose saveDB as no-op for backward compatibility
    saveDB: () => {},
  };
}

module.exports = { createRepositoryFactory };
