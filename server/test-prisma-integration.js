/**
 * Prisma Integration Test Suite
 *
 * Tests all 3 active repositories (users, players, categories) backed by Prisma Client.
 * Creates test data, verifies CRUD operations, then cleans up.
 *
 * Run: node test-prisma-integration.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getPrisma, disconnectPrisma } = require('./src/db/prisma');
const { createRepositoryFactory } = require('./src/db/index');
const bcrypt = require('bcryptjs');

let prisma;
let repos;

// Test data IDs (cleaned up after tests)
const TEST_IDS = {
  orgId: null,
  userId: null,
  userId2: null,
  competitionId: null,
  categoryId: null,
  playerId: null,
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

  // Create test organization
  const org = await prisma.organizations.create({
    data: { name: 'Prisma Test Org', status: 'ACTIVE' },
  });
  TEST_IDS.orgId = org.id;

  // Create test competition
  const comp = await prisma.competitions.create({
    data: {
      organization_id: org.id,
      name: 'Prisma Test Competition',
      status: 'DRAFT',
    },
  });
  TEST_IDS.competitionId = comp.id;

  console.log(`  Created org: ${org.id}`);
  console.log(`  Created competition: ${comp.id}`);
}

async function cleanup() {
  console.log('\n=== Cleanup: Removing test data ===\n');

  try {
    // Delete players first (FK to competition)
    if (TEST_IDS.playerId) {
      await prisma.players.delete({ where: { id: TEST_IDS.playerId } }).catch(() => {});
    }
    if (TEST_IDS.competitionId) {
      await prisma.players.deleteMany({ where: { competition_id: TEST_IDS.competitionId } }).catch(() => {});
    }

    // Delete categories
    if (TEST_IDS.categoryId) {
      await prisma.categories.delete({ where: { id: TEST_IDS.categoryId } }).catch(() => {});
    }

    // Delete users
    if (TEST_IDS.userId) {
      await prisma.users.delete({ where: { id: TEST_IDS.userId } }).catch(() => {});
    }
    if (TEST_IDS.userId2) {
      await prisma.users.delete({ where: { id: TEST_IDS.userId2 } }).catch(() => {});
    }

    // Delete competition
    if (TEST_IDS.competitionId) {
      await prisma.competitions.delete({ where: { id: TEST_IDS.competitionId } }).catch(() => {});
    }

    // Delete organization
    if (TEST_IDS.orgId) {
      await prisma.organizations.delete({ where: { id: TEST_IDS.orgId } }).catch(() => {});
    }

    console.log('  Test data cleaned up');
  } catch (e) {
    console.error('  Cleanup error:', e.message);
  }
}

// ── UserRepository Tests ──

async function testUserRepository() {
  console.log('\n=== UserRepository Tests ===\n');

  const hash = bcrypt.hashSync('testpass123', 10);

  // 1. create
  const user = await repos.users.create({
    username: 'prisma_test_user',
    password: hash,
    role: 'ORG_ADMIN',
    organizationId: TEST_IDS.orgId,
  });
  TEST_IDS.userId = user.id;
  assert(user && user.id, 'users.create() returns created user with id');
  assert(user.username === 'prisma_test_user', 'users.create() sets username');
  assert(user.role === 'ORG_ADMIN', 'users.create() sets role');
  assert(user.organization_id === TEST_IDS.orgId, 'users.create() sets organization_id');
  assert(user.status === 'ACTIVE', 'users.create() defaults status to ACTIVE');
  assert(!user.password_hash, 'users.create() excludes password_hash from response');

  // 2. findByUsername
  const found = await repos.users.findByUsername('prisma_test_user');
  assert(found && found.id === user.id, 'users.findByUsername() finds by username');
  assert(found.password_hash, 'users.findByUsername() includes password_hash');

  // 3. findByUsernameSafe
  const safe = await repos.users.findByUsernameSafe('prisma_test_user');
  assert(safe && safe.id === user.id, 'users.findByUsernameSafe() finds user');
  assert(!safe.password_hash, 'users.findByUsernameSafe() excludes password_hash');
  assert(!safe.created_at, 'users.findByUsernameSafe() excludes created_at');

  // 4. findById
  const byId = await repos.users.findById(user.id);
  assert(byId && byId.id === user.id, 'users.findById() finds by UUID');
  assert(byId.organization_id === TEST_IDS.orgId, 'users.findById() returns organization_id');
  assert(!byId.password_hash, 'users.findById() excludes password_hash');

  // 5. findAll
  const all = await repos.users.findAll();
  assert(Array.isArray(all) && all.length > 0, 'users.findAll() returns array');
  assert(all.some(u => u.id === user.id), 'users.findAll() includes created user');
  assert(!all[0].password_hash, 'users.findAll() excludes password_hash');

  // 6. findByRole
  const admins = await repos.users.findByRole('ORG_ADMIN');
  assert(Array.isArray(admins) && admins.some(u => u.id === user.id), 'users.findByRole() filters by role');

  // 7. findByOrganization
  const orgUsers = await repos.users.findByOrganization(TEST_IDS.orgId);
  assert(Array.isArray(orgUsers) && orgUsers.some(u => u.id === user.id), 'users.findByOrganization() filters by org');

  // 8. updateStatus
  await repos.users.updateStatus(user.id, 'INACTIVE');
  const updated = await repos.users.findById(user.id);
  assert(updated.status === 'INACTIVE', 'users.updateStatus() updates status');

  // Reset for later tests
  await repos.users.updateStatus(user.id, 'ACTIVE');

  // 9. updatePassword
  const newHash = bcrypt.hashSync('newpass456', 10);
  await repos.users.updatePassword(user.id, newHash);
  const afterPwd = await repos.users.findByUsername('prisma_test_user');
  assert(afterPwd.password_hash === newHash, 'users.updatePassword() updates password_hash');

  // 10. Create second user (for count verification)
  const user2 = await repos.users.create({
    username: 'prisma_test_user2',
    password: hash,
    role: 'JUDGE',
    organizationId: TEST_IDS.orgId,
  });
  TEST_IDS.userId2 = user2.id;
  assert(user2 && user2.id, 'users.create() second user succeeds');
}

// ── CategoryRepository Tests ──

async function testCategoryRepository() {
  console.log('\n=== CategoryRepository Tests ===\n');

  // 1. create
  const cat = await repos.categories.create({
    name: 'PRISMA_TEST_CAT',
    minAge: 5,
    maxAge: 8,
  });
  TEST_IDS.categoryId = cat.id;
  assert(cat && cat.id, 'categories.create() returns created category with id');
  assert(cat.name === 'PRISMA_TEST_CAT', 'categories.create() sets name');
  assert(cat.min_age === 5, 'categories.create() sets min_age');
  assert(cat.max_age === 8, 'categories.create() sets max_age');

  // 2. findById
  const byId = await repos.categories.findById(cat.id);
  assert(byId && byId.id === cat.id, 'categories.findById() finds by UUID');
  assert(byId.name === 'PRISMA_TEST_CAT', 'categories.findById() returns name');

  // 3. findByName
  const byName = await repos.categories.findByName('PRISMA_TEST_CAT');
  assert(byName && byName.id === cat.id, 'categories.findByName() finds by name');

  // 4. findAll
  const all = await repos.categories.findAll();
  assert(Array.isArray(all) && all.length > 0, 'categories.findAll() returns array');
  assert(all.some(c => c.id === cat.id), 'categories.findAll() includes test category');

  // 5. findByAge
  // Use age 5 — only our test category (5-8) matches, not seeded U6 (0-6)
  const ageMatch = await repos.categories.findByAge(5);
  assert(ageMatch && ageMatch.id === cat.id, 'categories.findByAge(5) matches min=5, max=8');

  const noMatch = await repos.categories.findByAge(20);
  assert(noMatch === null, 'categories.findByAge(20) returns null for out-of-range');

  // 6. update
  const updated = await repos.categories.update(cat.id, { name: 'PRISMA_TEST_CAT_V2', minAge: 4 });
  assert(updated.name === 'PRISMA_TEST_CAT_V2', 'categories.update() updates name');
  assert(updated.min_age === 4, 'categories.update() updates min_age');
  assert(updated.max_age === 8, 'categories.update() preserves unchanged fields');

  // 7. update with no fields
  const noop = await repos.categories.update(cat.id, {});
  assert(noop && noop.id === cat.id, 'categories.update({}) returns current record');

  // Reset name for cleanup
  await repos.categories.update(cat.id, { name: 'PRISMA_TEST_CAT' });

  // 8. countPlayers (should be 0 initially)
  const count = await repos.categories.countPlayers(cat.id);
  assert(count === 0, 'categories.countPlayers() returns 0 for empty category');
}

// ── PlayerRepository Tests ──

async function testPlayerRepository() {
  console.log('\n=== PlayerRepository Tests ===\n');

  // 1. create
  const player = await repos.players.create({
    competitionId: TEST_IDS.competitionId,
    name: 'Prisma Test Player',
    school: 'Test School',
    province: 'Test Province',
    age: 7,
    categoryId: TEST_IDS.categoryId,
  });
  TEST_IDS.playerId = player.id;
  assert(player && player.id, 'players.create() returns created player with id');
  assert(player.name === 'Prisma Test Player', 'players.create() sets name');
  assert(player.competition_id === TEST_IDS.competitionId, 'players.create() sets competition_id');
  assert(player.category_id === TEST_IDS.categoryId, 'players.create() sets category_id');
  assert(player.school === 'Test School', 'players.create() sets school');
  assert(player.age === 7, 'players.create() sets age');

  // 2. findById
  const byId = await repos.players.findById(player.id);
  assert(byId && byId.id === player.id, 'players.findById() finds by UUID');

  // 3. findByCompetition
  const byComp = await repos.players.findByCompetition(TEST_IDS.competitionId);
  assert(Array.isArray(byComp) && byComp.length === 1, 'players.findByCompetition() returns players');
  assert(byComp[0].categories && byComp[0].categories.name, 'players.findByCompetition() includes category name');

  // 4. findByCompetitionAndCategory
  const byCat = await repos.players.findByCompetitionAndCategory(TEST_IDS.competitionId, TEST_IDS.categoryId);
  assert(Array.isArray(byCat) && byCat.length === 1, 'players.findByCompetitionAndCategory() returns filtered players');

  const noMatch = await repos.players.findByCompetitionAndCategory(TEST_IDS.competitionId, '00000000-0000-0000-0000-000000000000');
  assert(Array.isArray(noMatch) && noMatch.length === 0, 'players.findByCompetitionAndCategory() returns empty for wrong category');

  // 5. update
  const updated = await repos.players.update(player.id, { name: 'Updated Player', school: 'New School' });
  assert(updated.name === 'Updated Player', 'players.update() updates name');
  assert(updated.school === 'New School', 'players.update() updates school');
  assert(updated.age === 7, 'players.update() preserves unchanged fields');

  // 6. update with no fields
  const noop = await repos.players.update(player.id, {});
  assert(noop && noop.id === player.id, 'players.update({}) returns current record');

  // 7. countByCompetition
  const count = await repos.players.countByCompetition(TEST_IDS.competitionId);
  assert(count === 1, 'players.countByCompetition() returns 1');

  // 8. countByCompetitionAndCategory
  const countCat = await repos.players.countByCompetitionAndCategory(TEST_IDS.competitionId, TEST_IDS.categoryId);
  assert(countCat === 1, 'players.countByCompetitionAndCategory() returns 1');

  // 9. countPlayers on category (cross-repo verification)
  const catPlayerCount = await repos.categories.countPlayers(TEST_IDS.categoryId);
  assert(catPlayerCount === 1, 'categories.countPlayers() returns 1 after player creation');

  // 10. Create a second player for delete tests
  const player2 = await repos.players.create({
    competitionId: TEST_IDS.competitionId,
    name: 'Player To Delete',
  });
  assert(player2 && player2.id, 'players.create() second player succeeds');

  // 11. delete
  await repos.players.delete(player2.id);
  const deleted = await repos.players.findById(player2.id);
  assert(deleted === null, 'players.delete() removes the player');

  // 12. deleteByCompetition
  // Add another player
  await repos.players.create({
    competitionId: TEST_IDS.competitionId,
    name: 'Extra Player',
  });
  const countBefore = await repos.players.countByCompetition(TEST_IDS.competitionId);
  assert(countBefore === 2, 'players.countByCompetition() returns 2 before bulk delete');

  const deletedCount = await repos.players.deleteByCompetition(TEST_IDS.competitionId);
  assert(deletedCount === 2, 'players.deleteByCompetition() returns count of deleted players');

  const countAfter = await repos.players.countByCompetition(TEST_IDS.competitionId);
  assert(countAfter === 0, 'players.countByCompetition() returns 0 after bulk delete');
}

// ── Cross-Repository Integration Tests ──

async function testCrossRepository() {
  console.log('\n=== Cross-Repository Integration Tests ===\n');

  // Create a user via repo, find via prisma directly
  const hash = bcrypt.hashSync('integration', 10);
  const user = await repos.users.create({
    username: 'prisma_cross_test',
    password: hash,
    role: 'PLAYER',
    organizationId: TEST_IDS.orgId,
  });
  assert(user && user.id, 'cross-repo: user created via repo');

  // Verify Prisma can read it directly
  const directRead = await prisma.users.findUnique({ where: { id: user.id } });
  assert(directRead && directRead.username === 'prisma_cross_test', 'cross-repo: Prisma direct read matches repo write');

  // Verify repo can find what Prisma wrote directly
  const directWrite = await prisma.categories.create({
    data: { name: 'PRISMA_DIRECT_CAT', min_age: 10, max_age: 12 },
  });
  const repoRead = await repos.categories.findById(directWrite.id);
  assert(repoRead && repoRead.name === 'PRISMA_DIRECT_CAT', 'cross-repo: repo read matches Prisma direct write');

  // Cleanup
  await prisma.users.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.categories.delete({ where: { id: directWrite.id } }).catch(() => {});
}

// ── Prisma Client Direct Tests ──

async function testPrismaDirect() {
  console.log('\n=== Prisma Client Direct Tests ===\n');

  // Verify Prisma Client can connect and query
  const orgCount = await prisma.organizations.count();
  assert(typeof orgCount === 'number', 'prisma.organizations.count() returns number');

  // Verify raw query works
  const [rawResult] = await prisma.$queryRaw`SELECT 1 as test`;
  assert(rawResult && rawResult.test !== undefined, 'prisma.$queryRaw works');

  // Verify schema introspection (model exists)
  const userCount = await prisma.users.count();
  assert(typeof userCount === 'number', 'prisma.users.count() returns number');
}

// ── Error Handling Tests ──

async function testErrorHandling() {
  console.log('\n=== Error Handling Tests ===\n');

  // findByUsername with non-existent user
  const notFound = await repos.users.findByUsername('nonexistent_user_xyz');
  assert(notFound === null, 'users.findByUsername() returns null for non-existent user');

  // findById with invalid UUID format
  try {
    await repos.users.findById('not-a-uuid');
    assert(false, 'users.findById() should throw for invalid UUID');
  } catch (e) {
    assert(true, 'users.findById() throws for invalid UUID format');
  }

  // findByCompetition with non-existent ID
  const emptyList = await repos.players.findByCompetition('00000000-0000-0000-0000-000000000000');
  assert(Array.isArray(emptyList) && emptyList.length === 0, 'players.findByCompetition() returns empty array for non-existent competition');

  // delete non-existent player (should not throw with Prisma)
  try {
    await repos.players.delete('00000000-0000-0000-0000-000000000000');
    assert(false, 'players.delete() should throw for non-existent record');
  } catch (e) {
    assert(true, 'players.delete() throws for non-existent record');
  }
}

// ── Main ──

async function main() {
  console.log('========================================');
  console.log('  Prisma Integration Test Suite');
  console.log('========================================');

  try {
    await setup();

    await testPrismaDirect();
    await testUserRepository();
    await testCategoryRepository();
    await testPlayerRepository();
    await testCrossRepository();
    await testErrorHandling();

    console.log('\n========================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('========================================');

    if (failed > 0) {
      console.error(`\n${failed} test(s) FAILED!`);
    } else {
      console.log('\nAll tests PASSED!');
    }
  } catch (e) {
    console.error('\nTest suite error:', e);
  } finally {
    await cleanup();
    await disconnectPrisma();

    // Print summary report
    console.log('\n========================================');
    console.log('  Prisma Integration Report');
    console.log('========================================');
    console.log(`Total tests:  ${passed + failed}`);
    console.log(`Passed:       ${passed}`);
    console.log(`Failed:       ${failed}`);
    console.log(`Pass rate:    ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log('========================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
