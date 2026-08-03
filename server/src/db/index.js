/**
 * Database repository factory.
 * Creates all repositories backed by a single database connection.
 *
 * Usage:
 *   const { createRepositoryFactory } = require('./db');
 *   const repos = createRepositoryFactory(dbConnection);
 *   await repos.users.findById(1);
 *   await repos.scores.addTeamPoints(tid, rid, teamId, 10);
 */

const UserRepository = require('./repositories/UserRepository');
const TournamentRepository = require('./repositories/TournamentRepository');
const RoundRepository = require('./repositories/RoundRepository');
const PuzzleRepository = require('./repositories/PuzzleRepository');
const TeamRepository = require('./repositories/TeamRepository');
const SubmissionRepository = require('./repositories/SubmissionRepository');
const ScoreRepository = require('./repositories/ScoreRepository');
const PlayerStateRepository = require('./repositories/PlayerStateRepository');
const TeamPuzzleSetRepository = require('./repositories/TeamPuzzleSetRepository');
const ParticipantRepository = require('./repositories/ParticipantRepository');

function createRepositoryFactory(dbConnection) {
  const { run, all, get, saveDB, transaction } = dbConnection;

  const db = { run, all, get, transaction };

  return {
    users: new UserRepository(db),
    tournaments: new TournamentRepository(db),
    rounds: new RoundRepository(db),
    puzzles: new PuzzleRepository(db),
    teams: new TeamRepository(db),
    submissions: new SubmissionRepository(db),
    scores: new ScoreRepository(db),
    playerStates: new PlayerStateRepository(db),
    teamPuzzleSets: new TeamPuzzleSetRepository(db),
    participants: new ParticipantRepository(db),

    // Expose saveDB as no-op for backward compatibility (PG auto-commits)
    saveDB: saveDB || (() => {}),
  };
}

module.exports = { createRepositoryFactory };
