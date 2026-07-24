/**
 * Test script for TournamentRepository.deleteCascade
 * Tests the fix for team_puzzle_sets FK violation.
 * Run: node test-delete-cascade.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const { createPostgresConnection } = require('./src/db/connection');
  const { createRepositoryFactory } = require('./src/db/index');

  const conn = await createPostgresConnection();
  const repos = createRepositoryFactory(conn);

  console.log('=== Test 1: Create tournament with teams, rounds, and team_puzzle_sets ===');

  // Create tournament
  const tournament = await repos.tournaments.create({
    name: 'Delete Test Tournament',
    description: 'Testing cascade delete with team_puzzle_sets',
    createdBy: null
  });
  console.log('Created tournament:', tournament.id);

  // Create teams (method takes { tournamentId, name })
  const team1 = await repos.teams.create({ tournamentId: tournament.id, name: 'Team Alpha' });
  const team2 = await repos.teams.create({ tournamentId: tournament.id, name: 'Team Beta' });
  console.log('Created teams:', team1.id, team2.id);

  // Add members (method takes { teamId, playerId, position })
  await repos.teams.addMember({ teamId: team1.id, playerId: 1, position: 1 });
  await repos.teams.addMember({ teamId: team2.id, playerId: 2, position: 1 });
  console.log('Added team members');

  // Create a round
  const round = await repos.rounds.create({
    tournamentId: tournament.id,
    roundNumber: 1,
    name: 'Round 1',
    roundType: 'ROUND1',
    durationSeconds: 600
  });
  console.log('Created round:', round.id);

  // Create puzzle (create returns void, so query it back)
  await repos.puzzles.create({
    roundId: round.id,
    puzzleType: 'SUDOKU',
    orderInRound: 1,
    initialGrid: JSON.stringify([[1,2],[3,4]]),
    solution: JSON.stringify([[1,2],[3,4]]),
    points: 100,
    letter: 'A'
  });
  const puzzle = await conn.get('SELECT * FROM puzzles WHERE round_id = ? ORDER BY id DESC LIMIT 1', [round.id]);
  console.log('Created puzzle:', puzzle.id);

  // Create team_puzzle_sets (THIS is the table that caused the FK violation)
  await repos.teamPuzzleSets.persist(tournament.id, round.id, team1.id, 'TESTWORD1', '1,2,3');
  await repos.teamPuzzleSets.persist(tournament.id, round.id, team2.id, 'TESTWORD2', '4,5,6');
  console.log('Created team_puzzle_sets for both teams');

  // Create submissions
  await repos.submissions.create({
    roundId: round.id, playerId: 1, puzzleId: puzzle.id,
    teamId: team1.id, submissionType: 'CELL', submittedValue: '5',
    isCorrect: true, pointsEarned: 10
  });
  console.log('Created submission');

  // Create scores
  await repos.scores.addTeamPoints(tournament.id, round.id, team1.id, 50);
  console.log('Created scores');

  // Verify data exists before delete
  const beforeDelete = {
    tournament: await conn.get('SELECT COUNT(*) as cnt FROM tournaments WHERE id = $1', [tournament.id]),
    rounds: await conn.get('SELECT COUNT(*) as cnt FROM rounds WHERE tournament_id = $1', [tournament.id]),
    teams: await conn.get('SELECT COUNT(*) as cnt FROM teams WHERE tournament_id = $1', [tournament.id]),
    teamPuzzleSets: await conn.get('SELECT COUNT(*) as cnt FROM team_puzzle_sets WHERE tournament_id = $1', [tournament.id]),
    submissions: await conn.get('SELECT COUNT(*) as cnt FROM submissions WHERE round_id = $1', [round.id]),
    scores: await conn.get('SELECT COUNT(*) as cnt FROM scores WHERE tournament_id = $1', [tournament.id]),
  };
  console.log('\nBefore delete:');
  for (const [k, v] of Object.entries(beforeDelete)) {
    console.log(`  ${k}: ${v.cnt}`);
  }

  console.log('\n=== Test 2: Delete tournament (cascade) ===');
  try {
    await repos.tournaments.deleteCascade(tournament.id);
    console.log('deleteCascade completed WITHOUT errors!');
  } catch (err) {
    console.error('deleteCascade FAILED:', err.message);
    process.exit(1);
  }

  // Verify all data is gone
  const afterDelete = {
    tournament: await conn.get('SELECT COUNT(*) as cnt FROM tournaments WHERE id = $1', [tournament.id]),
    rounds: await conn.get('SELECT COUNT(*) as cnt FROM rounds WHERE tournament_id = $1', [tournament.id]),
    teams: await conn.get('SELECT COUNT(*) as cnt FROM teams WHERE tournament_id = $1', [tournament.id]),
    teamPuzzleSets: await conn.get('SELECT COUNT(*) as cnt FROM team_puzzle_sets WHERE tournament_id = $1', [tournament.id]),
    submissions: await conn.get('SELECT COUNT(*) as cnt FROM submissions WHERE round_id = $1', [round.id]),
    scores: await conn.get('SELECT COUNT(*) as cnt FROM scores WHERE tournament_id = $1', [tournament.id]),
  };
  console.log('\nAfter delete:');
  for (const [k, v] of Object.entries(afterDelete)) {
    console.log(`  ${k}: ${v.cnt}`);
  }

  const allZero = Object.values(afterDelete).every(r => parseInt(r.cnt) === 0);
  console.log('\n=== RESULT ===');
  if (allZero) {
    console.log('PASSED - All child records deleted cleanly');
  } else {
    console.log('FAILED - Some records remain');
    process.exit(1);
  }

  // Test 3: Delete empty tournament (no rounds)
  console.log('\n=== Test 3: Delete tournament with no rounds ===');
  const t2 = await repos.tournaments.create({
    name: 'Empty Tournament',
    description: 'No rounds',
    createdBy: null
  });
  console.log('Created empty tournament:', t2.id);
  try {
    await repos.tournaments.deleteCascade(t2.id);
    const check = await conn.get('SELECT COUNT(*) as cnt FROM tournaments WHERE id = $1', [t2.id]);
    if (parseInt(check.cnt) === 0) {
      console.log('PASSED - Empty tournament deleted');
    } else {
      console.log('FAILED - Empty tournament still exists');
      process.exit(1);
    }
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }

  console.log('\n=== ALL TESTS PASSED ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
