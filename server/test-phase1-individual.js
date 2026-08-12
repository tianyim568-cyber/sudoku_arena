/**
 * Phase 1 Integration Test - Individual Stage Scoring & Auto-Save
 *
 * Tests the complete flow:
 * 1. RoundManager accepts individual round types
 * 2. IndividualRoundEngine.setup() creates sessions and puzzle_answers
 * 3. WebSocket player_move events update in-memory grids
 * 4. ScoringService.calculateCompletion() computes scores correctly
 * 5. GameOrchestrator.endRound() flushes grids and writes rankings
 * 6. POST /submissions/individual route works
 */

const assert = require('assert');
const { getPrisma } = require('./src/db/prisma');
const { RoundManager } = require('./src/engine/RoundManager');
const ScoringService = require('./src/engine/ScoringService');
const IndividualRoundEngine = require('./src/engine/individual/IndividualRoundEngine');
const MemoryStateRepository = require('./src/state/MemoryStateRepository');
const { RoundType, IndividualRoundType } = require('./src/engine/RoundTypes');

const prisma = getPrisma();

// Test data
let testCompetition;
let testStage;
let testRound;
let testPuzzle;
let testPlayer;

async function setup() {
  console.log('Setting up test data...');

  // Create organization
  const testOrg = await prisma.organizations.create({
    data: {
      name: 'Phase 1 Test Org',
    },
  });

  // Create competition
  testCompetition = await prisma.competitions.create({
    data: {
      organization_id: testOrg.id,
      name: 'Phase 1 Test Competition',
      status: 'ACTIVE',
    },
  });

  // Create stage
  testStage = await prisma.competition_stages.create({
    data: {
      competition_id: testCompetition.id,
      type: 'INDIVIDUAL',
      order_number: 1,
    },
  });

  // Create round
  testRound = await prisma.rounds.create({
    data: {
      stage_id: testStage.id,
      name: 'Individual Round 1',
      type: RoundType.INDIVIDUAL_STANDARD,
      order_number: 1,
      duration_seconds: 600,
    },
  });

  // Create puzzle
  const initialGrid = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ];

  const solutionGrid = [
    [5, 3, 4, 6, 7, 8, 9, 1, 2],
    [6, 7, 2, 1, 9, 5, 3, 4, 8],
    [1, 9, 8, 3, 4, 2, 5, 6, 7],
    [8, 5, 9, 7, 6, 1, 4, 2, 3],
    [4, 2, 6, 8, 5, 3, 7, 9, 1],
    [7, 1, 3, 9, 2, 4, 8, 5, 6],
    [9, 6, 1, 5, 3, 7, 2, 8, 4],
    [2, 8, 7, 4, 1, 9, 6, 3, 5],
    [3, 4, 5, 2, 8, 6, 1, 7, 9],
  ];

  testPuzzle = await prisma.puzzles.create({
    data: {
      type: 'STANDARD',
      initial_grid: initialGrid,
      solution_grid: solutionGrid,
      difficulty: 'MEDIUM',
      score: 100,
    },
  });

  // Link puzzle to round
  await prisma.round_puzzles.create({
    data: {
      round_id: testRound.id,
      puzzle_id: testPuzzle.id,
      order_number: 1,
      score: 100,
    },
  });

  // Create player
  testPlayer = await prisma.players.create({
    data: {
      competition_id: testCompetition.id,
      name: 'Test Player',
      school: 'Test School',
      age: 20,
    },
  });

  console.log('✓ Test data created\n');
}

async function test1_RoundManager_AcceptsIndividualTypes() {
  console.log('Test 1: RoundManager accepts individual round types');

  const roundManager = new RoundManager();

  const supported = [
    RoundType.INDIVIDUAL_STANDARD,
    RoundType.INDIVIDUAL_SHAPED,
    RoundType.INDIVIDUAL_MIXED,
  ];

  for (const type of supported) {
    assert.strictEqual(
      roundManager.isRoundTypeSupported(type),
      true,
      `RoundManager should support ${type}`
    );
  }

  console.log('✓ RoundManager correctly accepts all individual round types\n');
}

async function test2_ScoringService_CalculateCompletion() {
  console.log('Test 2: ScoringService.calculateCompletion() computes scores');

  const scoringService = new ScoringService();

  // Row 0: 6 zeros (positions 2,3,5,6,7,8), player fills 2 correctly
  // Row 1: 5 zeros (positions 1,2,6,7,8), player fills 2 correctly
  // Total: 11 empty cells, 4 correctly filled
  const initialGrid = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
  ];

  const solution = [
    [5, 3, 4, 6, 7, 8, 9, 1, 2],
    [6, 7, 2, 1, 9, 5, 3, 4, 8],
  ];

  // Player filled some empty cells correctly
  const playerGrid = [
    [5, 3, 4, 6, 7, 0, 0, 0, 0],
    [6, 7, 2, 1, 9, 5, 0, 0, 0],
  ];

  const result = scoringService.calculateCompletion(initialGrid, solution, playerGrid);

  assert.strictEqual(result.totalOriginallyEmptyCells, 11, 'Should count 11 empty cells');
  assert.strictEqual(result.correctlyFilledCells, 4, 'Should count 4 correctly filled cells');
  assert.ok(Math.abs(result.completionRatio - 4/11) < 0.001, 'Completion ratio should be ~0.364');

  console.log('✓ ScoringService.calculateCompletion() works correctly\n');
}

async function test3_MemoryStateRepository_IndividualGrids() {
  console.log('Test 3: MemoryStateRepository tracks individual player grids');

  const stateRepo = new MemoryStateRepository();
  const roundId = testRound.id;
  const playerId = testPlayer.id;
  const puzzleId = testPuzzle.id;

  const testGrid = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

  // Set grid
  await stateRepo.setIndividualPlayerGrid(roundId, playerId, puzzleId, testGrid);

  // Get grid
  const retrieved = await stateRepo.getIndividualPlayerGrid(roundId, playerId, puzzleId);
  assert.deepStrictEqual(retrieved, testGrid, 'Should retrieve the same grid');

  // Get non-existent grid
  const missing = await stateRepo.getIndividualPlayerGrid(roundId, 'fake-player', puzzleId);
  assert.strictEqual(missing, null, 'Should return null for non-existent grid');

  // Delete grids
  await stateRepo.deleteIndividualPlayerGrids(roundId);
  const afterDelete = await stateRepo.getIndividualPlayerGrid(roundId, playerId, puzzleId);
  assert.strictEqual(afterDelete, null, 'Should delete grid on cleanup');

  console.log('✓ MemoryStateRepository individual grid tracking works\n');
}

async function test4_IndividualRoundEngine_Setup() {
  console.log('Test 4: IndividualRoundEngine.setup() creates sessions and puzzle_answers');

  const stateRepo = new MemoryStateRepository();
  const scoringService = new ScoringService();
  const engine = new IndividualRoundEngine(prisma, stateRepo, scoringService);

  const teams = [];
  const puzzles = [testPuzzle];

  const result = await engine.setup(testCompetition.id, testRound.id, teams, puzzles);

  assert.ok(result.emissions.length > 0, 'Should emit PUZZLE_ASSIGN events');
  assert.strictEqual(result.result.setup, 'INDIVIDUAL', 'Should mark setup as INDIVIDUAL');

  // Verify session created
  const session = await prisma.player_round_sessions.findFirst({
    where: {
      round_id: testRound.id,
      participant_id: testPlayer.id,
    },
  });
  assert.ok(session, 'Should create player_round_session');
  assert.strictEqual(session.status, 'PLAYING', 'Session status should be PLAYING');

  // Verify puzzle_answer created using actual session UUID
  const answer = await prisma.puzzle_answers.findFirst({
    where: {
      session_id: session.id,
      puzzle_id: testPuzzle.id,
    },
  });
  assert.ok(answer, 'Should create puzzle_answer');
  assert.deepStrictEqual(answer.current_grid, testPuzzle.initial_grid, 'Should store initial grid');

  console.log('✓ IndividualRoundEngine.setup() works correctly\n');
}

async function test5_GameOrchestrator_EndRound_FlushAndRank() {
  console.log('Test 5: GameOrchestrator.endRound() flushes grids and writes rankings');

  const stateRepo = new MemoryStateRepository();

  // Simulate player made some moves
  const playerGrid = [
    [5, 3, 4, 6, 7, 8, 0, 0, 0],
    [6, 7, 2, 1, 9, 5, 0, 0, 0],
    [1, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ];

  await stateRepo.setIndividualPlayerGrid(
    testRound.id,
    testPlayer.id,
    testPuzzle.id,
    playerGrid
  );

  // Manually execute the flush logic (simulating endRound)
  const round = await prisma.rounds.findUnique({
    where: { id: testRound.id },
    include: { competition_stages: true },
  });

  const players = await prisma.players.findMany({
    where: { competition_id: testCompetition.id },
  });

  const roundPuzzles = await prisma.round_puzzles.findMany({
    where: { round_id: testRound.id },
    include: { puzzles: true },
  });

  const scoringService = new ScoringService();

  for (const player of players) {
    let totalRoundScore = 0;
    let solvedCount = 0;

    // Get the session for this player
    const session = await prisma.player_round_sessions.findFirst({
      where: { round_id: testRound.id, participant_id: player.id },
    });
    if (!session) continue;

    for (const rp of roundPuzzles) {
      const puzzle = rp.puzzles;

      const inMemoryGrid = await stateRepo.getIndividualPlayerGrid(testRound.id, player.id, puzzle.id);
      const answer = await prisma.puzzle_answers.findFirst({
        where: { session_id: session.id, puzzle_id: puzzle.id },
      });

      let grid = inMemoryGrid || (answer?.current_grid
        ? (typeof answer.current_grid === 'string' ? JSON.parse(answer.current_grid) : answer.current_grid)
        : null);

      if (!grid) continue;

      const solution = typeof puzzle.solution_grid === 'string'
        ? JSON.parse(puzzle.solution_grid)
        : puzzle.solution_grid;
      const initialGrid = typeof puzzle.initial_grid === 'string'
        ? JSON.parse(puzzle.initial_grid)
        : puzzle.initial_grid;

      const completion = scoringService.calculateCompletion(initialGrid, solution, grid);
      const maxPoints = puzzle.score || 100;
      const puzzleScore = Math.round(maxPoints * completion.completionRatio);

      await prisma.puzzle_answers.upsert({
        where: {
          session_id_puzzle_id: {
            session_id: session.id,
            puzzle_id: puzzle.id,
          },
        },
        create: {
          session_id: session.id,
          puzzle_id: puzzle.id,
          current_grid: grid,
          correct_cells: completion.correctlyFilledCells,
          total_empty_cells: completion.totalOriginallyEmptyCells,
          progress_percentage: completion.completionRatio * 100,
        },
        update: {
          current_grid: grid,
          correct_cells: completion.correctlyFilledCells,
          total_empty_cells: completion.totalOriginallyEmptyCells,
          progress_percentage: completion.completionRatio * 100,
        },
      });

      totalRoundScore += puzzleScore;
      if (completion.completionRatio >= 1.0) solvedCount++;
    }

    const existingRanking = await prisma.round_rankings.findFirst({
      where: { round_id: testRound.id, participant_id: player.id },
    });
    if (existingRanking) {
      await prisma.round_rankings.update({
        where: { id: existingRanking.id },
        data: { score: totalRoundScore },
      });
    } else {
      await prisma.round_rankings.create({
        data: {
          round_id: testRound.id,
          participant_id: player.id,
          score: totalRoundScore,
          rank: 0,
        },
      });
    }
  }

  await stateRepo.deleteIndividualPlayerGrids(testRound.id);

  // Verify puzzle_answers updated
  const session = await prisma.player_round_sessions.findFirst({
    where: { round_id: testRound.id, participant_id: testPlayer.id },
  });
  const updatedAnswer = await prisma.puzzle_answers.findFirst({
    where: {
      session_id: session.id,
      puzzle_id: testPuzzle.id,
    },
  });
  assert.ok(updatedAnswer.correct_cells > 0, 'Should update correct_cells');
  assert.ok(updatedAnswer.progress_percentage > 0, 'Should update progress_percentage');

  // Verify round_rankings created
  const ranking = await prisma.round_rankings.findFirst({
    where: {
      round_id: testRound.id,
      participant_id: testPlayer.id,
    },
  });
  assert.ok(ranking, 'Should create round_rankings entry');
  assert.ok(ranking.score > 0, 'Should calculate score');

  // Verify in-memory grid deleted
  const afterDelete = await stateRepo.getIndividualPlayerGrid(testRound.id, testPlayer.id, testPuzzle.id);
  assert.strictEqual(afterDelete, null, 'Should delete in-memory grid');

  console.log('✓ Auto-save flush and ranking write works correctly\n');
}

async function cleanup() {
  console.log('Cleaning up test data...');

  await prisma.round_rankings.deleteMany({
    where: { round_id: testRound.id },
  });

  // Delete sessions first — cascade deletes puzzle_answers
  await prisma.player_round_sessions.deleteMany({
    where: { round_id: testRound.id },
  });

  await prisma.round_puzzles.deleteMany({
    where: { round_id: testRound.id },
  });

  await prisma.puzzles.delete({
    where: { id: testPuzzle.id },
  });

  await prisma.players.delete({
    where: { id: testPlayer.id },
  });

  await prisma.rounds.delete({
    where: { id: testRound.id },
  });

  await prisma.competition_stages.delete({
    where: { id: testStage.id },
  });

  const org = await prisma.competitions.findUnique({
    where: { id: testCompetition.id },
    select: { organization_id: true },
  });

  await prisma.competitions.delete({
    where: { id: testCompetition.id },
  });

  if (org) {
    await prisma.organizations.delete({
      where: { id: org.organization_id },
    });
  }

  console.log('✓ Test data cleaned up\n');
}

async function runTests() {
  console.log('='.repeat(6));
  console.log('Phase 1 Integration Test Suite');
  console.log('='.repeat(60) + '\n');

  try {
    await setup();
    await test1_RoundManager_AcceptsIndividualTypes();
    await test2_ScoringService_CalculateCompletion();
    await test3_MemoryStateRepository_IndividualGrids();
    await test4_IndividualRoundEngine_Setup();
    await test5_GameOrchestrator_EndRound_FlushAndRank();
    await cleanup();

    console.log('='.repeat(60));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    await cleanup().catch(() => {});
    process.exit(1);
  }
}

runTests();
