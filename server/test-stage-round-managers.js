/**
 * Stage & Round Manager Integration Tests
 *
 * Tests StageManager, RoundManager, state persistence, and GameOrchestrator
 * preparation flow with real database and state repository.
 *
 * Run: node test-stage-round-managers.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getPrisma, disconnectPrisma } = require('./src/db/prisma');
const { createRepositoryFactory } = require('./src/db/index');
const { createStateRepository } = require('./src/state/index');
const { StageManager, StageState } = require('./src/engine/StageManager');
const { RoundManager, RoundLifecycleState } = require('./src/engine/RoundManager');
const EmissionBus = require('./src/ws/EmissionBus');
const TimerService = require('./src/engine/TimerService');

let prisma;
let repos;
let state;
let bus;

// Test data IDs (cleaned up after tests)
const TEST_IDS = {
  orgId: null,
  competitionId: null,
  stageId: null,
  roundIds: [],
  teamId: null,
  puzzleIds: [],
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function setup() {
  console.log('\n=== Setup: Creating test data ===\n');

  prisma = getPrisma();
  repos = createRepositoryFactory(prisma);
  state = createStateRepository();
  bus = new EmissionBus();

  // Create test organization
  const org = await prisma.organizations.create({
    data: { name: 'Stage/Round Test Org', status: 'ACTIVE' },
  });
  TEST_IDS.orgId = org.id;

  // Create test competition
  const comp = await prisma.competitions.create({
    data: {
      organization_id: org.id,
      name: 'Stage/Round Test Competition',
      status: 'DRAFT',
    },
  });
  TEST_IDS.competitionId = comp.id;

  // Create test stage
  const stage = await prisma.competition_stages.create({
    data: {
      competition_id: comp.id,
      type: 'INDIVIDUAL',
      order_number: 1,
      status: 'WAITING',
    },
  });
  TEST_IDS.stageId = stage.id;

  // Create 3 test rounds
  for (let i = 1; i <= 3; i++) {
    const round = await prisma.rounds.create({
      data: {
        stage_id: stage.id,
        name: `Test Round ${i}`,
        type: i === 1 ? 'ROUND1_NINE_ONE' : i === 2 ? 'ROUND2_RELAY' : 'ROUND3_COLLABORATE',
        order_number: i,
        duration_seconds: 300,
        preparation_seconds: 10,
        status: 'WAITING',
      },
    });
    TEST_IDS.roundIds.push(round.id);
  }

  // Create test team
  const team = await prisma.teams.create({
    data: {
      competition_id: comp.id,
      name: 'Test Team',
    },
  });
  TEST_IDS.teamId = team.id;

  // Create test puzzles
  for (let i = 1; i <= 3; i++) {
    const puzzle = await prisma.puzzles.create({
      data: {
        type: 'SUDOKU',
        difficulty: 'medium',
        initial_grid: { size: 9, cells: [] },
        solution_grid: { size: 9, cells: [] },
        score: 100,
      },
    });
    TEST_IDS.puzzleIds.push(puzzle.id);

    // Link puzzle to round
    await prisma.round_puzzles.create({
      data: {
        round_id: TEST_IDS.roundIds[0],
        puzzle_id: puzzle.id,
        order_number: i,
        score: 100,
      },
    });
  }

  console.log(`  Created org: ${org.id}`);
  console.log(`  Created competition: ${comp.id}`);
  console.log(`  Created stage: ${stage.id}`);
  console.log(`  Created ${TEST_IDS.roundIds.length} rounds`);
  console.log(`  Created team: ${team.id}`);
  console.log(`  Created ${TEST_IDS.puzzleIds.length} puzzles`);
}

async function cleanup() {
  console.log('\n=== Cleanup: Removing test data ===\n');

  try {
    // Delete round_puzzles
    for (const roundId of TEST_IDS.roundIds) {
      await prisma.round_puzzles.deleteMany({ where: { round_id: roundId } }).catch(() => {});
    }

    // Delete rounds
    for (const roundId of TEST_IDS.roundIds) {
      await prisma.rounds.delete({ where: { id: roundId } }).catch(() => {});
    }

    // Delete puzzles
    for (const puzzleId of TEST_IDS.puzzleIds) {
      await prisma.puzzles.delete({ where: { id: puzzleId } }).catch(() => {});
    }

    // Delete team
    if (TEST_IDS.teamId) {
      await prisma.teams.delete({ where: { id: TEST_IDS.teamId } }).catch(() => {});
    }

    // Delete stage
    if (TEST_IDS.stageId) {
      await prisma.competition_stages.delete({ where: { id: TEST_IDS.stageId } }).catch(() => {});
    }

    // Delete competition
    if (TEST_IDS.competitionId) {
      await prisma.competitions.delete({ where: { id: TEST_IDS.competitionId } }).catch(() => {});
    }

    // Delete organization
    if (TEST_IDS.orgId) {
      await prisma.organizations.delete({ where: { id: TEST_IDS.orgId } }).catch(() => {});
    }

    console.log('  Cleanup completed');
  } catch (err) {
    console.error('  Cleanup error:', err.message);
  }
}

// ─── Test Suite: StageManager ───────────────────────────────────

async function testStageManager() {
  console.log('\n=== StageManager Tests ===\n');

  const stageManager = new StageManager(state, bus);

  // Test 1: loadStageContext
  console.log('Test: loadStageContext');
  const ctx = await stageManager.loadStageContext(TEST_IDS.competitionId, TEST_IDS.stageId);
  assert(ctx !== null, 'Context loaded successfully');
  assert(ctx.stageId === TEST_IDS.stageId, 'Context has correct stageId');
  assert(ctx.stageType === 'INDIVIDUAL', 'Context has correct stageType');
  assert(ctx.stageStatus === 'WAITING', 'Context has correct initial status');
  assert(ctx.rounds.length === 3, 'Context loaded all 3 rounds');

  // Test 2: getContext
  console.log('\nTest: getContext');
  const currentCtx = stageManager.getContext();
  assert(currentCtx !== null, 'getContext returns loaded context');
  assert(currentCtx.stageId === TEST_IDS.stageId, 'getContext returns correct stage');

  // Test 3: getStageType
  console.log('\nTest: getStageType');
  const stageType = stageManager.getStageType();
  assert(stageType === 'INDIVIDUAL', 'getStageType returns INDIVIDUAL');

  // Test 4: getTotalRounds
  console.log('\nTest: getTotalRounds');
  const totalRounds = stageManager.getTotalRounds();
  assert(totalRounds === 3, 'getTotalRounds returns 3');

  // Test 5: startStage
  console.log('\nTest: startStage');
  const startResult = await stageManager.startStage(TEST_IDS.competitionId, TEST_IDS.stageId);
  assert(startResult.result.status === 'STAGE_STARTED', 'startStage returns STAGE_STARTED status');
  assert(startResult.emissions.length === 1, 'startStage emits 1 event');
  assert(startResult.emissions[0].event === 'STAGE_STARTED', 'startStage emits STAGE_STARTED event');

  // Verify DB updated
  const stageInDb = await prisma.competition_stages.findUnique({ where: { id: TEST_IDS.stageId } });
  assert(stageInDb.status === 'STAGE_STARTED', 'Stage status updated in DB');

  // Test 6: Cannot start already started stage
  console.log('\nTest: Cannot start already started stage');
  try {
    await stageManager.startStage(TEST_IDS.competitionId, TEST_IDS.stageId);
    assert(false, 'Should throw error for already started stage');
  } catch (err) {
    assert(err.message.includes('Cannot start stage'), 'Throws error for already started stage');
  }

  // Test 7: finishStage (without finished rounds - should fail)
  console.log('\nTest: finishStage without finished rounds');
  try {
    await stageManager.finishStage();
    assert(false, 'Should throw error when rounds not finished');
  } catch (err) {
    assert(err.message.includes('not finished'), 'Throws error when rounds not finished');
  }

  // Test 8: Manually finish all rounds in DB
  console.log('\nTest: Manually finish all rounds');
  for (const roundId of TEST_IDS.roundIds) {
    await prisma.rounds.update({
      where: { id: roundId },
      data: { status: 'FINISHED' },
    });
  }
  const finishedRounds = await prisma.rounds.findMany({
    where: { stage_id: TEST_IDS.stageId, status: 'FINISHED' },
  });
  assert(finishedRounds.length === 3, 'All 3 rounds marked as FINISHED');

  // Test 9: finishStage (with finished rounds - should succeed)
  console.log('\nTest: finishStage with finished rounds');
  const finishResult = await stageManager.finishStage();
  assert(finishResult.result.status === 'STAGE_FINISHED', 'finishStage returns STAGE_FINISHED status');
  assert(finishResult.emissions.length === 1, 'finishStage emits 1 event');
  assert(finishResult.emissions[0].event === 'STAGE_FINISHED', 'finishStage emits STAGE_FINISHED event');

  // Verify DB updated
  const finishedStageInDb = await prisma.competition_stages.findUnique({ where: { id: TEST_IDS.stageId } });
  assert(finishedStageInDb.status === 'STAGE_FINISHED', 'Stage status updated to FINISHED in DB');

  // Test 10: transitionToNextStage (no next stage exists)
  console.log('\nTest: transitionToNextStage (no next stage)');
  try {
    await stageManager.transitionToNextStage();
    assert(false, 'Should throw error when no next stage');
  } catch (err) {
    assert(err.message.includes('No next stage'), 'Throws error when no next stage');
  }

  // Test 11: loadAllStages
  console.log('\nTest: loadAllStages');
  const allStages = await stageManager.loadAllStages(TEST_IDS.competitionId);
  assert(allStages.length === 1, 'loadAllStages returns 1 stage');
  assert(allStages[0].id === TEST_IDS.stageId, 'loadAllStages returns correct stage');

  // Test 12: findFirstStage
  console.log('\nTest: findFirstStage');
  const firstStage = await stageManager.findFirstStage(TEST_IDS.competitionId);
  assert(firstStage !== null, 'findFirstStage returns a stage');
  assert(firstStage.id === TEST_IDS.stageId, 'findFirstStage returns correct stage');

  // Reset rounds for next test
  for (const roundId of TEST_IDS.roundIds) {
    await prisma.rounds.update({
      where: { id: roundId },
      data: { status: 'WAITING' },
    });
  }
  await prisma.competition_stages.update({
    where: { id: TEST_IDS.stageId },
    data: { status: 'WAITING' },
  });
}

// ─── Test Suite: RoundManager ───────────────────────────────────

async function testRoundManager() {
  console.log('\n=== RoundManager Tests ===\n');

  const timer = new TimerService(state);
  const roundManager = new RoundManager(state, bus, timer);

  // Test 1: prepareRound
  console.log('Test: prepareRound');
  await roundManager.prepareRound(TEST_IDS.competitionId, TEST_IDS.stageId, TEST_IDS.roundIds[0]);
  const ctx = roundManager.getContext();
  assert(ctx !== null, 'Context loaded successfully');
  assert(ctx.roundId === TEST_IDS.roundIds[0], 'Context has correct roundId');
  assert(ctx.roundType === 'ROUND1_NINE_ONE', 'Context has correct roundType');
  assert(ctx.durationSeconds === 300, 'Context has correct durationSeconds');
  assert(ctx.preparationSeconds === 10, 'Context has correct preparationSeconds');
  assert(ctx.lifecycleState === 'PREPARATION', 'Context lifecycle is PREPARATION');

  // Test 2: getRoundType
  console.log('\nTest: getRoundType');
  const roundType = roundManager.getRoundType();
  assert(roundType === 'ROUND1_NINE_ONE', 'getRoundType returns ROUND1_NINE_ONE');

  // Test 3: getLifecycleState
  console.log('\nTest: getLifecycleState');
  const lifecycle = roundManager.getLifecycleState();
  assert(lifecycle === 'PREPARATION', 'getLifecycleState returns PREPARATION');

  // Test 4: startPreparation
  console.log('\nTest: startPreparation');
  let prepEnded = false;
  const prepResult = await roundManager.startPreparation(TEST_IDS.competitionId, () => {
    prepEnded = true;
  });
  assert(prepResult.result !== null, 'startPreparation returns result');
  assert(prepResult.emissions.length > 0, 'startPreparation emits events');
  assert(prepResult.emissions.some(e => e.event === 'ROUND_PREPARATION_STARTED'), 'startPreparation emits ROUND_PREPARATION_STARTED');
  // Note: TIMER_TICK is emitted asynchronously by startTickInterval, not synchronously in the emissions array

  // Test 5: clearPreparationTimer
  console.log('\nTest: clearPreparationTimer');
  roundManager.clearPreparationTimer();
  assert(true, 'clearPreparationTimer executed without error');

  // Test 6: activateRound
  console.log('\nTest: activateRound');
  const activateResult = await roundManager.activateRound();
  assert(activateResult.result.status === 'IN_PROGRESS', 'activateRound returns IN_PROGRESS status');
  assert(roundManager.getLifecycleState() === 'ROUND_ACTIVE', 'Lifecycle updated to ROUND_ACTIVE');

  // Verify DB updated
  const roundInDb = await prisma.rounds.findUnique({ where: { id: TEST_IDS.roundIds[0] } });
  assert(roundInDb.status === 'IN_PROGRESS', 'Round status updated in DB');
  assert(roundInDb.started_at !== null, 'Round started_at timestamp set');

  // Test 7: startGameplayTimer
  console.log('\nTest: startGameplayTimer');
  let timerExpired = false;
  const timerResult = await roundManager.startGameplayTimer(TEST_IDS.competitionId, () => {
    timerExpired = true;
  });
  assert(timerResult.turnEndsAt > Date.now(), 'startGameplayTimer returns future turnEndsAt');

  // Test 8: clearTimerTick
  console.log('\nTest: clearTimerTick');
  roundManager.clearTimerTick();
  assert(true, 'clearTimerTick executed without error');

  // Test 9: finishRound
  console.log('\nTest: finishRound');
  const finishResult = await roundManager.finishRound();
  assert(finishResult.result.status === 'FINISHED', 'finishRound returns FINISHED status');
  assert(finishResult.emissions.length > 0, 'finishRound emits events');
  assert(roundManager.getLifecycleState() === 'ROUND_FINISHED', 'Lifecycle updated to ROUND_FINISHED');

  // Verify DB updated
  const finishedRoundInDb = await prisma.rounds.findUnique({ where: { id: TEST_IDS.roundIds[0] } });
  assert(finishedRoundInDb.status === 'FINISHED', 'Round status updated to FINISHED in DB');
  assert(finishedRoundInDb.ended_at !== null, 'Round ended_at timestamp set');

  // Test 10: findNextRound
  console.log('\nTest: findNextRound');
  const nextRound = await roundManager.getNextRound();
  assert(nextRound !== null, 'getNextRound returns next round');
  assert(nextRound.id === TEST_IDS.roundIds[1], 'getNextRound returns correct next round');

  // Test 11: hasNextRound
  console.log('\nTest: hasNextRound');
  const hasNext = await roundManager.hasNextRound();
  assert(hasNext === true, 'hasNextRound returns true');

  // Reset round for next test
  await prisma.rounds.update({
    where: { id: TEST_IDS.roundIds[0] },
    data: { status: 'WAITING', started_at: null, ended_at: null },
  });
}

// ─── Test Suite: State Persistence ─────────────────────────────

async function testStatePersistence() {
  console.log('\n=== State Persistence Tests ===\n');

  const stageManager = new StageManager(state, bus);
  await stageManager.loadStageContext(TEST_IDS.competitionId, TEST_IDS.stageId);

  // Test 1: saveContext
  console.log('Test: saveContext');
  await stageManager.saveContext();
  const savedCtx = await state.getStageContext(TEST_IDS.competitionId);
  assert(savedCtx !== null, 'Context saved to state');
  assert(savedCtx.stageId === TEST_IDS.stageId, 'Saved context has correct stageId');

  // Test 2: restoreContext
  console.log('\nTest: restoreContext');
  const stageManager2 = new StageManager(state, bus);
  const restoredCtx = await stageManager2.restoreContext(TEST_IDS.competitionId);
  assert(restoredCtx !== null, 'Context restored from state');
  assert(restoredCtx.stageId === TEST_IDS.stageId, 'Restored context has correct stageId');
  assert(stageManager2.getContext() !== null, 'Restored context loaded into manager');

  // Test 3: clearContext
  console.log('\nTest: clearContext');
  await stageManager2.clearContext();
  const clearedCtx = await state.getStageContext(TEST_IDS.competitionId);
  assert(clearedCtx === null, 'Context cleared from state');
  assert(stageManager2.getContext() === null, 'Context cleared from manager');
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  try {
    await setup();

    await testStageManager();
    await testRoundManager();
    await testStatePersistence();

    console.log('\n=== Test Summary ===');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Total:  ${passed + failed}\n`);

    await cleanup();
    await disconnectPrisma();

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n✗ Fatal error:', err.message);
    console.error(err.stack);
    await cleanup();
    await disconnectPrisma();
    process.exit(1);
  }
}

main();
