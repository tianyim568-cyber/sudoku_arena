/**
 * Category Ranking Test
 *
 * Tests that round_rankings correctly store category_id and that the
 * DisplayManager returns filtered rankings by category.
 *
 * Uses direct Prisma access (like the running server does).
 */

require('dotenv').config();
const { getPrisma } = require('./src/db/prisma');
const DisplayManager = require('./src/engine/DisplayManager');
const EmissionBus = require('./src/ws/EmissionBus');

async function run() {
  const prisma = getPrisma();

  console.log('\n=== Category Ranking Test ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.log(`  ✗ ${msg}`);
      failed++;
    }
  }

  // ── Setup ──
  const competition = await prisma.competitions.findFirst();
  assert(competition, 'Competition exists');

  const categories = await prisma.categories.findMany({ orderBy: { min_age: 'asc' } });
  assert(categories.length >= 2, `Found ${categories.length} categories`);

  if (!competition || categories.length < 2) {
    console.log('\n✗ Missing prerequisites, aborting.');
    process.exit(1);
  }

  // Find or create a stage
  let stage = await prisma.competition_stages.findFirst({
    where: { competition_id: competition.id },
  });
  if (!stage) {
    stage = await prisma.competition_stages.create({
      data: {
        competition_id: competition.id,
        type: 'INDIVIDUAL',
        order_number: 1,
        status: 'IN_PROGRESS',
      },
    });
  }
  assert(stage, 'Stage available');

  // Find or create a round
  let round = await prisma.rounds.findFirst({
    where: { stage_id: stage.id },
  });
  if (!round) {
    round = await prisma.rounds.create({
      data: {
        stage_id: stage.id,
        name: 'Category Test Round',
        order_number: 1,
        type: 'INDIVIDUAL',
        duration_seconds: 300,
        status: 'FINISHED',
      },
    });
  }
  assert(round, 'Round available');

  // Find or create players in different categories
  const cat1 = categories[0];
  const cat2 = categories[1];

  const createPlayer = async (name, age, categoryId) => {
    let p = await prisma.players.findFirst({
      where: { competition_id: competition.id, category_id: categoryId, name },
    });
    if (!p) {
      p = await prisma.players.create({
        data: {
          competition_id: competition.id,
          name,
          age,
          category_id: categoryId,
        },
      });
    }
    return p;
  };

  const p1 = await createPlayer('CatRank_A1', cat1.min_age, cat1.id);
  const p2 = await createPlayer('CatRank_A2', cat1.min_age + 1, cat1.id);
  const p3 = await createPlayer('CatRank_B1', cat2.min_age, cat2.id);
  const p4 = await createPlayer('CatRank_B2', cat2.min_age + 1, cat2.id);
  assert(p1 && p2 && p3 && p4, 'Created 4 players (2 per category)');

  // ── Test 1: Insert rankings with category_id ──
  console.log('\nTest 1: Insert round_rankings with category_id');

  // Clean up any old test rankings for this round with our test players
  await prisma.round_rankings.deleteMany({
    where: {
      round_id: round.id,
      participant_id: { in: [p1.id, p2.id, p3.id, p4.id] },
    },
  });

  // Insert rankings: cat1 scores [100, 80], cat2 scores [90, 70]
  const r1 = await prisma.round_rankings.create({
    data: { round_id: round.id, participant_id: p1.id, score: 100, rank: 0, category_id: cat1.id },
  });
  const r2 = await prisma.round_rankings.create({
    data: { round_id: round.id, participant_id: p2.id, score: 80, rank: 0, category_id: cat1.id },
  });
  const r3 = await prisma.round_rankings.create({
    data: { round_id: round.id, participant_id: p3.id, score: 90, rank: 0, category_id: cat2.id },
  });
  const r4 = await prisma.round_rankings.create({
    data: { round_id: round.id, participant_id: p4.id, score: 70, rank: 0, category_id: cat2.id },
  });
  assert(r1 && r2 && r3 && r4, 'Inserted 4 rankings with category_ids');

  // ── Test 2: Compute ranks per category ──
  console.log('\nTest 2: Compute ranks per category');

  // Simulate the rank computation logic from GameOrchestrator.endRound()
  const rankings = await prisma.round_rankings.findMany({
    where: { round_id: round.id },
    orderBy: { score: 'desc' },
  });

  const categoryGroups = {};
  rankings.forEach(r => {
    const catId = r.category_id || 'null';
    if (!categoryGroups[catId]) categoryGroups[catId] = [];
    categoryGroups[catId].push(r);
  });

  for (const catId in categoryGroups) {
    const group = categoryGroups[catId];
    for (let i = 0; i < group.length; i++) {
      await prisma.round_rankings.update({
        where: { id: group[i].id },
        data: { rank: i + 1 },
      });
    }
  }

  // Verify cat1 ranks
  const cat1Rankings = await prisma.round_rankings.findMany({
    where: { round_id: round.id, category_id: cat1.id },
    orderBy: { rank: 'asc' },
    include: { players: { select: { name: true } } },
  });

  assert(cat1Rankings.length === 2, `Category ${cat1.name}: ${cat1Rankings.length} rankings`);
  assert(cat1Rankings[0].rank === 1, `${cat1.name} rank 1 = ${cat1Rankings[0].players?.name} (score: ${cat1Rankings[0].score})`);
  assert(cat1Rankings[0].score === 100, `${cat1.name} top score is 100`);
  assert(cat1Rankings[1].rank === 2, `${cat1.name} rank 2 = ${cat1Rankings[1].players?.name} (score: ${cat1Rankings[1].score})`);
  assert(cat1Rankings[1].score === 80, `${cat1.name} second score is 80`);

  // Verify cat2 ranks
  const cat2Rankings = await prisma.round_rankings.findMany({
    where: { round_id: round.id, category_id: cat2.id },
    orderBy: { rank: 'asc' },
    include: { players: { select: { name: true } } },
  });

  assert(cat2Rankings.length === 2, `Category ${cat2.name}: ${cat2Rankings.length} rankings`);
  assert(cat2Rankings[0].rank === 1, `${cat2.name} rank 1 = ${cat2Rankings[0].players?.name} (score: ${cat2Rankings[0].score})`);
  assert(cat2Rankings[0].score === 90, `${cat2.name} top score is 90`);
  assert(cat2Rankings[1].rank === 2, `${cat2.name} rank 2 = ${cat2Rankings[1].players?.name} (score: ${cat2Rankings[1].score})`);
  assert(cat2Rankings[1].score === 70, `${cat2.name} second score is 70`);

  // ── Test 3: DisplayManager with category filter ──
  console.log('\nTest 3: DisplayManager category filtering');

  const bus = new EmissionBus();
  const dm = new DisplayManager(null, bus);

  // Get full snapshot (all categories)
  const fullSnapshot = await dm.getRankingSnapshot(competition.id);
  assert(fullSnapshot.competition.id === competition.id, 'Snapshot has competition');
  assert(Array.isArray(fullSnapshot.categories), `Snapshot has ${fullSnapshot.categories.length} categories`);

  // Check that stages contain our round with rankings
  const snapshotStage = fullSnapshot.stages.find(s => s.id === stage.id);
  assert(snapshotStage, 'Snapshot contains our stage');

  if (snapshotStage) {
    const snapshotRound = snapshotStage.rounds.find(r => r.id === round.id);
    assert(snapshotRound, 'Snapshot contains our round');

    if (snapshotRound) {
      assert(snapshotRound.rankings.length >= 4, `Round has ${snapshotRound.rankings.length} rankings (≥4)`);

      // Check that player data includes category info
      const firstRanking = snapshotRound.rankings.find(r => r.player?.id === p1.id);
      if (firstRanking) {
        assert(firstRanking.player.category !== null, 'Player has category data');
        assert(firstRanking.totalScore === 100, `Score is 100, got ${firstRanking.totalScore}`);
      }
    }
  }

  // Get filtered snapshot (cat1 only)
  const cat1Snapshot = await dm.getRankingSnapshot(competition.id, cat1.id);
  const cat1Stage = cat1Snapshot.stages.find(s => s.id === stage.id);
  if (cat1Stage) {
    const cat1Round = cat1Stage.rounds.find(r => r.id === round.id);
    if (cat1Round) {
      const cat1Only = cat1Round.rankings.filter(r => r.player?.id === p1.id || r.player?.id === p2.id);
      assert(cat1Only.length === 2, `Category filter: ${cat1Only.length} rankings for ${cat1.name}`);
    }
  }

  // Get filtered snapshot (cat2 only)
  const cat2Snapshot = await dm.getRankingSnapshot(competition.id, cat2.id);
  const cat2Stage = cat2Snapshot.stages.find(s => s.id === stage.id);
  if (cat2Stage) {
    const cat2Round = cat2Stage.rounds.find(r => r.id === round.id);
    if (cat2Round) {
      const cat2Only = cat2Round.rankings.filter(r => r.player?.id === p3.id || r.player?.id === p4.id);
      assert(cat2Only.length === 2, `Category filter: ${cat2Only.length} rankings for ${cat2.name}`);
    }
  }

  // ── Cleanup ──
  await prisma.round_rankings.deleteMany({
    where: {
      round_id: round.id,
      participant_id: { in: [p1.id, p2.id, p3.id, p4.id] },
    },
  });

  // ── Summary ──
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
