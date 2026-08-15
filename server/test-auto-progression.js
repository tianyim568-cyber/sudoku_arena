/**
 * Auto-Progression Integration Test
 *
 * Tests the complete auto-progression flow:
 * 1. Round-to-round transition delay (ROUND_TRANSITION_STARTED emission)
 * 2. Stage auto-finish when last round ends
 * 3. Stage-to-stage progression (startNextStage method)
 * 4. Preparation → Active → Finished lifecycle
 */

const assert = require('assert');
const { getPrisma } = require('./src/db/prisma');
const GameOrchestrator = require('./src/engine/GameOrchestrator');
const MemoryStateRepository = require('./src/state/MemoryStateRepository');
const EmissionBus = require('./src/ws/EmissionBus');
const { createRepositoryFactory } = require('./src/db');
const { IndividualRoundType } = require('./src/engine/RoundTypes');

const prisma = getPrisma();
const repos = createRepositoryFactory(prisma);

// Test data
let testOrg;
let testCompetition;
let testStage1;
let testStage2;
let testRound1;
let testRound2;
let testRound3;
let testPuzzle1;
let testPuzzle2;
let testPuzzle3;

async function setup() {
  console.log('Setting up test data...\n');

  // Create organization
  testOrg = await prisma.organizations.create({
    data: { name: 'Auto-Progression Test Org' },
  });

  // Create competition
  testCompetition = await prisma.competitions.create({
    data: {
      organization_id: testOrg.id,
      name: 'Auto-Progression Test Competition',
      status: 'DRAFT',
    },
  });

  // Create two stages
  testStage1 = await prisma.competition_stages.create({
    data: {
      competition_id: testCompetition.id,
      type: 'INDIVIDUAL',
      order_number: 1,
      status: 'WAITING',
    },
  });

  testStage2 = await prisma.competition_stages.create({
    data: {
      competition_id: testCompetition.id,
      type: 'INDIVIDUAL',
      order_number: 2,
      status: 'WAITING',
    },
  });

  // Create puzzles
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

  testPuzzle1 = await prisma.puzzles.create({
    data: {
      type: 'STANDARD',
      initial_grid: initialGrid,
      solution_grid: solutionGrid,
      difficulty: 'MEDIUM',
      score: 100,
    },
  });

  testPuzzle2 = await prisma.puzzles.create({
    data: {
      type: 'STANDARD',
      initial_grid: initialGrid,
      solution_grid: solutionGrid,
      difficulty: 'MEDIUM',
      score: 100,
    },
  });

  testPuzzle3 = await prisma.puzzles.create({
    data: {
      type: 'STANDARD',
      initial_grid: initialGrid,
      solution_grid: solutionGrid,
      difficulty: 'HARD',
      score: 150,
    },
  });

  // Create 3 rounds in stage 1 (to test multi-round progression)
  testRound1 = await prisma.rounds.create({
    data: {
      stage_id: testStage1.id,
      name: 'Round 1',
      type: IndividualRoundType.INDIVIDUAL_STANDARD,
      order_number: 1,
      duration_seconds: 30, // Longer to prevent timer auto-expiry during test waits
      preparation_seconds: 1,
    },
  });

  testRound2 = await prisma.rounds.create({
    data: {
      stage_id: testStage1.id,
      name: 'Round 2',
      type: IndividualRoundType.INDIVIDUAL_STANDARD,
      order_number: 2,
      duration_seconds: 30,
      preparation_seconds: 1,
    },
  });

  testRound3 = await prisma.rounds.create({
    data: {
      stage_id: testStage1.id,
      name: 'Round 3 (Final)',
      type: IndividualRoundType.INDIVIDUAL_STANDARD,
      order_number: 3,
      duration_seconds: 30,
      preparation_seconds: 1,
    },
  });

  // Link puzzles to rounds
  await prisma.round_puzzles.createMany({
    data: [
      { round_id: testRound1.id, puzzle_id: testPuzzle1.id, order_number: 1, score: 100 },
      { round_id: testRound2.id, puzzle_id: testPuzzle2.id, order_number: 1, score: 100 },
      { round_id: testRound3.id, puzzle_id: testPuzzle3.id, order_number: 1, score: 150 },
    ],
  });

  console.log('✓ Test data created\n');
}

async function test1_RoundTransitionEmission() {
  console.log('Test 1: Round transition emits ROUND_TRANSITION_STARTED');

  const state = new MemoryStateRepository();
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);

  // Collect emissions via EventEmitter
  const emissions = [];
  bus.on('emission', (e) => emissions.push(e));
  bus.on('immediate', (e) => emissions.push(e));

  // Load stage context
  await orchestrator.stages.loadStageContext(testCompetition.id, testStage1.id);

  // Update competition to RUNNING (required for startRound)
  await prisma.competitions.update({
    where: { id: testCompetition.id },
    data: { status: 'RUNNING' },
  });

  // Prepare and activate round 1 (simulate it being active)
  await orchestrator.rounds.prepareRound(testCompetition.id, testStage1.id, testRound1.id);
  await orchestrator.rounds.activateRound();

  // End round 1 — should trigger transition to round 2
  const result = await orchestrator.endRound(testCompetition.id, testRound1.id);
  orchestrator.processEmissions(result.emissions);

  // Check for ROUND_TRANSITION_STARTED emission
  const transitionEvent = emissions.find(e => e.event === 'ROUND_TRANSITION_STARTED');
  assert.ok(transitionEvent, 'Should emit ROUND_TRANSITION_STARTED');
  assert.strictEqual(transitionEvent.payload.finishedRoundId, testRound1.id, 'Should include finished round ID');
  assert.strictEqual(transitionEvent.payload.nextRoundId, testRound2.id, 'Should include next round ID');
  assert.strictEqual(transitionEvent.payload.transitionSeconds, 5, 'Should include transition delay (5s)');

  console.log('✓ Round transition emission works correctly');

  // Wait for setTimeout to fire (5s transition + 1s preparation + 1s buffer)
  console.log('  Waiting for auto-start of next round (5s transition + prep)...');
  await new Promise(resolve => setTimeout(resolve, 7000));

  // Verify round 2 was auto-started (should be IN_PROGRESS)
  const round2 = await prisma.rounds.findUnique({
    where: { id: testRound2.id },
  });
  assert.strictEqual(round2.status, 'IN_PROGRESS', 'Round 2 should be auto-started after transition');

  console.log('✓ Round 2 auto-started after transition delay\n');
}

async function test2_StageAutoFinish() {
  console.log('Test 2: Stage auto-finishes when last round ends');

  // Clean state: mark rounds 1 and 2 as FINISHED, reset round 3 and stage
  await prisma.rounds.update({
    where: { id: testRound1.id },
    data: { status: 'FINISHED' },
  });
  await prisma.rounds.update({
    where: { id: testRound2.id },
    data: { status: 'FINISHED', started_at: null, ended_at: null },
  });
  await prisma.rounds.update({
    where: { id: testRound3.id },
    data: { status: 'WAITING', started_at: null, ended_at: null },
  });
  await prisma.competition_stages.update({
    where: { id: testStage1.id },
    data: { status: 'RUNNING' },
  });

  const state = new MemoryStateRepository();
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);

  const emissions = [];
  bus.on('emission', (e) => emissions.push(e));
  bus.on('immediate', (e) => emissions.push(e));

  // Load stage context
  await orchestrator.stages.loadStageContext(testCompetition.id, testStage1.id);

  // Prepare, activate, and end round 3 (last round — should auto-finish stage)
  await orchestrator.rounds.prepareRound(testCompetition.id, testStage1.id, testRound3.id);
  await orchestrator.rounds.activateRound();
  const result3 = await orchestrator.endRound(testCompetition.id, testRound3.id);
  orchestrator.processEmissions(result3.emissions);

  // Check for STAGE_FINISHED emission
  const stageFinishedEvent = emissions.find(e => e.event === 'STAGE_FINISHED');
  assert.ok(stageFinishedEvent, 'Should emit STAGE_FINISHED when last round ends');

  // Verify stage status
  const stage1 = await prisma.competition_stages.findUnique({
    where: { id: testStage1.id },
  });
  assert.strictEqual(stage1.status, 'FINISHED', 'Stage 1 should be auto-finished');

  console.log('✓ Stage auto-finish works correctly\n');
}

async function test3_StageToStageProgression() {
  console.log('Test 3: Stage-to-stage progression via startNextStage()');

  const state = new MemoryStateRepository();
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);

  // Create a round in stage 2 for the start to work
  const stage2Round = await prisma.rounds.create({
    data: {
      stage_id: testStage2.id,
      name: 'Stage 2 Round 1',
      type: IndividualRoundType.INDIVIDUAL_STANDARD,
      order_number: 1,
      duration_seconds: 60,
      preparation_seconds: 1,
    },
  });
  await prisma.round_puzzles.create({
    data: {
      round_id: stage2Round.id,
      puzzle_id: testPuzzle1.id,
      order_number: 1,
      score: 100,
    },
  });

  const emissions = [];
  bus.on('emission', (e) => emissions.push(e));

  // Load stage 1 context (already finished)
  await orchestrator.stages.loadStageContext(testCompetition.id, testStage1.id);

  // Call startNextStage — should transition to stage 2
  const result = await orchestrator.startNextStage(testCompetition.id);
  orchestrator.processEmissions(result.emissions);

  // Verify transition result
  assert.strictEqual(result.result.fromStageId, testStage1.id, 'Should include from stage ID');
  assert.strictEqual(result.result.toStageId, testStage2.id, 'Should include to stage ID');
  assert.strictEqual(result.result.toStageType, 'INDIVIDUAL', 'Should include to stage type');
  assert.strictEqual(result.result.status, 'STAGE_TRANSITIONED', 'Should have transitioned status');

  // Check for STAGE_TRANSITION emission
  const transitionEvent = emissions.find(e => e.event === 'STAGE_TRANSITION');
  assert.ok(transitionEvent, 'Should emit STAGE_TRANSITION');

  // Check for STAGE_STARTED emission for stage 2
  const stageStartedEvent = emissions.find(e => e.event === 'STAGE_STARTED');
  assert.ok(stageStartedEvent, 'Should emit STAGE_STARTED for next stage');

  // Verify stage 2 status
  const stage2 = await prisma.competition_stages.findUnique({
    where: { id: testStage2.id },
  });
  assert.strictEqual(stage2.status, 'RUNNING', 'Stage 2 should be started');

  // Cleanup stage 2 round
  await prisma.round_puzzles.deleteMany({ where: { round_id: stage2Round.id } });
  await prisma.rounds.delete({ where: { id: stage2Round.id } });

  console.log('✓ Stage-to-stage progression works correctly\n');
}

async function cleanup() {
  console.log('Cleaning up test data...');

  // Delete round_puzzles first
  await prisma.round_puzzles.deleteMany({
    where: {
      round_id: { in: [testRound1.id, testRound2.id, testRound3.id] },
    },
  }).catch(() => {});

  // Delete rounds
  await prisma.rounds.deleteMany({
    where: { id: { in: [testRound1.id, testRound2.id, testRound3.id] } },
  }).catch(() => {});

  // Delete puzzles
  await prisma.puzzles.deleteMany({
    where: { id: { in: [testPuzzle1.id, testPuzzle2.id, testPuzzle3.id] } },
  }).catch(() => {});

  // Delete stages
  await prisma.competition_stages.deleteMany({
    where: { competition_id: testCompetition.id },
  }).catch(() => {});

  // Delete competition
  await prisma.competitions.delete({
    where: { id: testCompetition.id },
  }).catch(() => {});

  // Delete org
  await prisma.organizations.delete({
    where: { id: testOrg.id },
  }).catch(() => {});

  console.log('✓ Test data cleaned up\n');
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Auto-Progression Integration Test Suite');
  console.log('='.repeat(60) + '\n');

  try {
    await setup();
    await test1_RoundTransitionEmission();
    await test2_StageAutoFinish();
    await test3_StageToStageProgression();
    await cleanup();

    console.log('='.repeat(60));
    console.log('ALL AUTO-PROGRESSION TESTS PASSED');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('\nTEST FAILED:', error.message);
    console.error(error.stack);
    await cleanup().catch(() => {});
    process.exit(1);
  }
}

runTests();
