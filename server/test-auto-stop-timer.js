/**
 * Real integration test for ISSUE-14 fix (2026-08-23).
 *
 * What this proves:
 *   When a round's gameplay timer elapses naturally (no judge clicking
 *   "end round"), the orchestrator's onTimerExpire callback now dispatches
 *   the emissions returned by endRound() to the EmissionBus — so any
 *   WebSocket listener (player client, big screen, judge console) would
 *   actually receive ROUND_FINISHED, score updates, etc.
 *
 * Before the fix, endRound() was called but its { result, emissions }
 * return value was dropped — the DB was updated, the round was marked
 * FINISHED, bonuses were computed, but no client ever saw it happen.
 *
 * Test scenario:
 *   1. Create a competition + 1 stage + 1 round with duration_seconds = 3.
 *   2. Wire an EmissionBus listener that records every event.
 *   3. Call orchestrator.startRound() (which calls startGameplayTimer).
 *   4. Wait ~6 seconds (let the timer elapse naturally).
 *   5. Assert that ROUND_FINISHED was received on the bus.
 *   6. Cleanup.
 *
 * Run with:  node test-auto-stop-timer.js
 * From the server/ directory.
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

// Test data IDs — kept in module scope so cleanup() can always find them.
let testOrg, testCompetition, testStage, testRound, testPuzzle;
// Track all created players for cleanup (endRound iterates players).
let createdPlayerIds = [];

const ROUND_DURATION_SECONDS = 3;
// Wait long enough for the 1-second tick interval to detect the expiry,
// plus a safety buffer for the endRound async chain to finish.
const WAIT_AFTER_EXPIRY_MS = 4000;

async function setup() {
  console.log('\n[setup] Creating test data...');

  testOrg = await prisma.organizations.create({
    data: { name: 'AutoStop Test Org' },
  });

  testCompetition = await prisma.competitions.create({
    data: {
      organization_id: testOrg.id,
      name: 'AutoStop Test Competition',
      status: 'DRAFT',
    },
  });

  testStage = await prisma.competition_stages.create({
    data: {
      competition_id: testCompetition.id,
      type: 'INDIVIDUAL',
      order_number: 1,
      status: 'WAITING',
    },
  });

  // Single trivial puzzle — we don't care about the grid, only about the
  // timer firing and endRound running.
  const grid = [
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
  testPuzzle = await prisma.puzzles.create({
    data: {
      type: 'STANDARD',
      initial_grid: grid,
      solution_grid: grid, // same → any "filled" cell counts as correct
      difficulty: 'EASY',
      score: 100,
    },
  });

  testRound = await prisma.rounds.create({
    data: {
      stage_id: testStage.id,
      name: 'AutoStop Round',
      type: IndividualRoundType.INDIVIDUAL_STANDARD,
      order_number: 1,
      duration_seconds: ROUND_DURATION_SECONDS,
      preparation_seconds: 1,
    },
  });

  await prisma.round_puzzles.create({
    data: {
      round_id: testRound.id,
      puzzle_id: testPuzzle.id,
      order_number: 1,
      score: 100,
    },
  });

  // endRound() iterates players — give it one dummy player so the loop
  // doesn't blow up. We don't care about its score, just that the round
  // ends without error. Suffix with a timestamp so re-runs don't collide
  // on the username unique constraint if a previous run left data behind.
  const runId = Date.now();
  const dummyUser = await prisma.users.create({
    data: {
      organization_id: testOrg.id,
      username: `autostop_dummy_${runId}`,
      password_hash: 'x',
      role: 'PLAYER',
    },
  });
  const dummyPlayer = await prisma.players.create({
    data: {
      competition_id: testCompetition.id,
      user_id: dummyUser.id,
      name: 'Dummy',
      category_id: null,
    },
  });
  createdPlayerIds.push(dummyPlayer.id);
  // Stash the user id too so we can delete the user after the player.
  createdPlayerIds.push({ kind: 'user', id: dummyUser.id });

  console.log('[setup] ✓ Test data created');
  console.log(`        competition=${testCompetition.id}`);
  console.log(`        stage=${testStage.id}`);
  console.log(`        round=${testRound.id} (duration=${ROUND_DURATION_SECONDS}s)`);
}

async function testAutoStopTimer() {
  console.log('\n[test] Auto-stop when timer expires (ISSUE-014 fix)');
  console.log('       Pre-condition: competition is RUNNING, round is ACTIVE.');

  const state = new MemoryStateRepository();
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);

  // Capture every emission the bus dispatches.
  const emissions = [];
  bus.on('emission', (e) => emissions.push(e));
  bus.on('immediate', (e) => emissions.push(e));

  // --- Move competition to RUNNING (startCompetition would also start the
  //     first stage, but doing it manually keeps the test minimal).
  await prisma.competitions.update({
    where: { id: testCompetition.id },
    data: { status: 'RUNNING' },
  });
  await prisma.competition_stages.update({
    where: { id: testStage.id },
    data: { status: 'RUNNING' },
  });

  // --- Load stage context, then call startRound — it does:
  //     prepareRound → startPreparation(1s) → on expiry, _activateAndStartRound
  //     → activateRound → engine.setup → startGameplayTimer (our fix is here).
  await orchestrator.stages.loadStageContext(testCompetition.id, testStage.id);

  console.log(`       Calling startRound() at ${new Date().toISOString()}...`);
  console.log(`        (preparation=1s, then gameplay=${ROUND_DURATION_SECONDS}s)`);
  const startResult = await orchestrator.startRound(testCompetition.id, testRound.id);
  orchestrator.processEmissions(startResult.emissions);

  // --- Sanity check: once preparation ends and gameplay starts, the round
  //     is IN_PROGRESS in DB. The preparation countdown is 1s — give it 2s
  //     before checking, so the activation has had time to run.
  console.log('       Waiting 2s for preparation to end and gameplay to start...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  const runningRound = await prisma.rounds.findUnique({ where: { id: testRound.id } });
  assert.strictEqual(
    runningRound.status,
    'IN_PROGRESS',
    `Round should be IN_PROGRESS after preparation, got ${runningRound.status}`
  );
  console.log(`       ✓ Round is IN_PROGRESS in DB (gameplay timer is running)`);

  // --- Wait for the timer to elapse naturally.
  //     duration=3s + 1s tick interval + 4s buffer = 8s wait.
  const totalWaitMs = ROUND_DURATION_SECONDS * 1000 + WAIT_AFTER_EXPIRY_MS;
  console.log(`       Waiting ${totalWaitMs / 1000}s for the timer to elapse naturally...`);
  await new Promise(resolve => setTimeout(resolve, totalWaitMs));

  // --- Read the final state.
  const finalRound = await prisma.rounds.findUnique({ where: { id: testRound.id } });
  const events = emissions.map(e => e.event);
  const roundFinishedEvent = emissions.find(e => e.event === 'ROUND_FINISHED');

  // --- Assertions: the things that were broken before the fix.
  // 1. The DB row is FINISHED (this worked before AND after — endRound always
  //    updated the DB).
  assert.strictEqual(
    finalRound.status,
    'FINISHED',
    `[DB] Round should be FINISHED after timer expiry, got ${finalRound.status}`
  );
  console.log('       ✓ Round status = FINISHED in DB');

  // 2. The ROUND_FINISHED emission reached the bus. THIS is what was broken
  //    before the fix — the callback dropped the emissions.
  assert.ok(
    roundFinishedEvent,
    `[BUS] Should have received ROUND_FINISHED emission. Got events: ${JSON.stringify(events)}`
  );
  assert.strictEqual(
    roundFinishedEvent.target,
    'competition',
    `[BUS] ROUND_FINISHED target should be 'competition'`
  );
  assert.strictEqual(
    roundFinishedEvent.targetId,
    testCompetition.id,
    `[BUS] ROUND_FINISHED targetId should be the competition id`
  );
  console.log('       ✓ ROUND_FINISHED emission received on the bus');

  // 3. endRound at minimum should also dispatch the ROUND_RANKING display-mode
  //    event (deferred via setTimeout, so may arrive slightly after). Not a
  //    hard assertion — the displayManager might not be wired here.

  // Print the full event log so a human reading the output can sanity-check.
  console.log(`       Events received on bus (${events.length} total):`);
  for (const ev of emissions) {
    const target = typeof ev.targetId === 'string'
      ? ev.targetId.slice(0, 8)
      : JSON.stringify(ev.targetId).slice(0, 30);
    console.log(`         - ${ev.event}  (target=${ev.target} ${target}...)`);
  }

  console.log('\n[test] ✓ PASS — auto-stop timer dispatches emissions correctly.');
}

async function cleanup() {
  console.log('\n[cleanup] Deleting test data...');

  // Delete players + users first (FKs)
  const userIds = createdPlayerIds
    .filter(x => typeof x === 'object' && x.kind === 'user')
    .map(x => x.id);
  const playerIds = createdPlayerIds.filter(x => typeof x === 'string');

  if (playerIds.length) {
    await prisma.players.deleteMany({ where: { id: { in: playerIds } } }).catch(() => {});
  }
  if (userIds.length) {
    await prisma.users.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  }

  await prisma.round_puzzles.deleteMany({ where: { round_id: testRound.id } }).catch(() => {});
  await prisma.rounds.deleteMany({ where: { id: testRound.id } }).catch(() => {});
  await prisma.puzzles.deleteMany({ where: { id: testPuzzle.id } }).catch(() => {});
  await prisma.competition_stages.deleteMany({ where: { id: testStage.id } }).catch(() => {});
  await prisma.competitions.deleteMany({ where: { id: testCompetition.id } }).catch(() => {});
  await prisma.organizations.deleteMany({ where: { id: testOrg.id } }).catch(() => {});

  console.log('[cleanup] ✓ Done');
}

async function main() {
  console.log('='.repeat(60));
  console.log('ISSUE-014 fix — real integration test');
  console.log('Round auto-stop via timer expiry must dispatch emissions');
  console.log('='.repeat(60));

  let exitCode = 0;
  try {
    await setup();
    await testAutoStopTimer();
  } catch (err) {
    console.error('\n[FAIL]', err.message);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    try { await cleanup(); } catch (e) { console.error('Cleanup error:', e.message); }
  }

  console.log('\n' + '='.repeat(60));
  console.log(exitCode === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  console.log('='.repeat(60));
  await prisma.$disconnect();
  process.exit(exitCode);
}

main();
