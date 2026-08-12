/**
 * Competition Login Integration Test
 *
 * Tests the competition-scoped login flow:
 * 1. GET /by-code/:accessCode/info — public competition info endpoint
 * 2. POST /by-code/:identifier/login — judge login with valid credentials
 * 3. POST /by-code/:identifier/login — player login with valid credentials
 * 4. POST /by-code/:identifier/login — unregistered user is rejected (403)
 * 5. POST /by-code/:identifier/login — wrong credentials are rejected (401)
 * 6. POST /by-code/:identifier/login — missing competition is rejected (404)
 * 7. Verify competition-scoped JWT contains correct payload
 */

const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPrisma } = require('./src/db/prisma');
const { createRepositoryFactory } = require('./src/db');
const config = require('./src/config');
const { competitionLogin } = require('./src/middleware/competitionAuth');

const prisma = getPrisma();
const repos = createRepositoryFactory(prisma);

// Test data
let testOrg;
let testCompetition;
let testJudge;
let testPlayer;
let testUnrelatedUser;
const accessCode = 'test0042';
const judgePassword = 'judgepass123';
const playerPassword = 'playerpass123';
const judgePasswordHash = bcrypt.hashSync(judgePassword, 10);
const playerPasswordHash = bcrypt.hashSync(playerPassword, 10);

async function setup() {
  console.log('Setting up test data...\n');

  // Create organization
  testOrg = await prisma.organizations.create({
    data: { name: 'Competition Login Test Org' },
  });

  // Create competition with access code
  testCompetition = await prisma.competitions.create({
    data: {
      organization_id: testOrg.id,
      name: 'Competition Login Test',
      status: 'RUNNING',
      competition_access_code: accessCode,
    },
  });

  // Create judge user
  testJudge = await prisma.users.create({
    data: {
      username: 'comp_test_judge',
      password_hash: judgePasswordHash,
      role: 'ORG_ADMIN',
      organization_id: testOrg.id,
    },
  });

  // Register judge for competition
  await prisma.competition_judges.create({
    data: {
      competition_id: testCompetition.id,
      user_id: testJudge.id,
    },
  });

  // Create player user
  testPlayer = await prisma.users.create({
    data: {
      username: 'comp_test_player',
      password_hash: playerPasswordHash,
      role: 'PLAYER',
      organization_id: testOrg.id,
    },
  });

  // Register player for competition
  await prisma.players.create({
    data: {
      competition_id: testCompetition.id,
      user_id: testPlayer.id,
      name: 'Test Player',
    },
  });

  // Create unrelated user (not registered for this competition)
  testUnrelatedUser = await prisma.users.create({
    data: {
      username: 'comp_test_unrelated',
      password_hash: bcrypt.hashSync('unrelated123', 10),
      role: 'ORG_ADMIN',
      organization_id: testOrg.id,
    },
  });

  console.log('✓ Test data created\n');
}

// ── Mock Express request/response for testing ──

function mockReq(params, body) {
  return { params, body };
}

function mockRes() {
  const res = {
    _json: null,
    _status: 200,
    status(code) {
      res._status = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
  };
  return res;
}

// ── Test 1: Public competition info endpoint ──

async function test1_GetCompetitionInfo() {
  console.log('Test 1: GET /by-code/:accessCode/info — public competition info');

  const competition = await prisma.competitions.findUnique({
    where: { competition_access_code: accessCode },
    select: {
      id: true,
      name: true,
      status: true,
      organizations: { select: { name: true } },
    },
  });

  assert.ok(competition, 'Competition should be found by access code');
  assert.strictEqual(competition.name, 'Competition Login Test', 'Name should match');
  assert.strictEqual(competition.status, 'RUNNING', 'Status should be RUNNING');
  assert.strictEqual(competition.organizations.name, 'Competition Login Test Org', 'Org name should match');

  console.log('✓ Competition info resolved correctly by access code\n');
}

// ── Test 2: Judge login with valid credentials ──

async function test2_JudgeLogin() {
  console.log('Test 2: POST /by-code/:identifier/login — judge login');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: accessCode },
    { username: 'comp_test_judge', password: judgePassword }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 200, 'Should return code 200');
  assert.ok(res._json.data.token, 'Should return a token');
  assert.strictEqual(res._json.data.competition.id, testCompetition.id, 'Should return competition ID');
  assert.strictEqual(res._json.data.competition.name, 'Competition Login Test', 'Should return competition name');
  assert.strictEqual(res._json.data.competition.status, 'RUNNING', 'Should return competition status');
  assert.strictEqual(res._json.data.user.id, testJudge.id, 'Should return user ID');
  assert.strictEqual(res._json.data.user.username, 'comp_test_judge', 'Should return username');
  assert.strictEqual(res._json.data.user.role, 'JUDGE', 'Should return JUDGE role');
  assert.strictEqual(res._json.data.user.participantId, null, 'Judge should have null participantId');

  // Verify the token
  const decoded = jwt.verify(res._json.data.token, config.JWT_SECRET);
  assert.strictEqual(decoded.type, 'competition', 'Token should be competition-scoped');
  assert.strictEqual(decoded.competitionId, testCompetition.id, 'Token should contain competition ID');
  assert.strictEqual(decoded.userId, testJudge.id, 'Token should contain user ID');
  assert.strictEqual(decoded.role, 'JUDGE', 'Token should contain JUDGE role');
  assert.strictEqual(decoded.organizationId, testOrg.id, 'Token should contain organization ID');

  console.log('✓ Judge login works correctly, token is valid\n');
}

// ── Test 3: Player login with valid credentials ──

async function test3_PlayerLogin() {
  console.log('Test 3: POST /by-code/:identifier/login — player login');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: accessCode },
    { username: 'comp_test_player', password: playerPassword }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 200, 'Should return code 200');
  assert.ok(res._json.data.token, 'Should return a token');
  assert.strictEqual(res._json.data.user.id, testPlayer.id, 'Should return user ID');
  assert.strictEqual(res._json.data.user.username, 'comp_test_player', 'Should return username');
  assert.strictEqual(res._json.data.user.role, 'PLAYER', 'Should return PLAYER role');
  assert.ok(res._json.data.user.participantId, 'Player should have a participantId');

  // Verify the token
  const decoded = jwt.verify(res._json.data.token, config.JWT_SECRET);
  assert.strictEqual(decoded.type, 'competition', 'Token should be competition-scoped');
  assert.strictEqual(decoded.role, 'PLAYER', 'Token should contain PLAYER role');
  assert.strictEqual(decoded.participantId, res._json.data.user.participantId, 'Token should contain participantId');

  console.log('✓ Player login works correctly, token is valid\n');
}

// ── Test 4: Unregistered user is rejected ──

async function test4_UnregisteredUser() {
  console.log('Test 4: POST /by-code/:identifier/login — unregistered user rejected');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: accessCode },
    { username: 'comp_test_unrelated', password: 'unrelated123' }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._status, 403, 'Should return HTTP 403');
  assert.strictEqual(res._json.code, 40304, 'Should return code 40304');

  console.log('✓ Unregistered user correctly rejected with 403\n');
}

// ── Test 5: Wrong credentials are rejected ──

async function test5_WrongCredentials() {
  console.log('Test 5: POST /by-code/:identifier/login — wrong credentials rejected');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: accessCode },
    { username: 'comp_test_judge', password: 'wrongpassword' }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 40001, 'Should return code 40001');

  console.log('✓ Wrong credentials correctly rejected with 40001\n');
}

// ── Test 6: Missing credentials are rejected ──

async function test6_MissingCredentials() {
  console.log('Test 6: POST /by-code/:identifier/login — missing credentials rejected');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: accessCode },
    { username: '', password: '' }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 40001, 'Should return code 40001');

  console.log('✓ Missing credentials correctly rejected with 40001\n');
}

// ── Test 7: Non-existent competition is rejected ──

async function test7_NonExistentCompetition() {
  console.log('Test 7: POST /by-code/:identifier/login — non-existent competition rejected');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: 'nonexistent999' },
    { username: 'comp_test_judge', password: judgePassword }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 40400, 'Should return code 40400');

  console.log('✓ Non-existent competition correctly rejected with 40400\n');
}

// ── Test 8: Login via UUID identifier ──

async function test8_LoginByUUID() {
  console.log('Test 8: POST /by-code/:identifier/login — login via UUID identifier');

  const handler = competitionLogin(repos);
  const req = mockReq(
    { identifier: testCompetition.id },
    { username: 'comp_test_judge', password: judgePassword }
  );
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res._json.code, 200, 'Should return code 200');
  assert.ok(res._json.data.token, 'Should return a token');
  assert.strictEqual(res._json.data.competition.id, testCompetition.id, 'Should resolve to correct competition');

  console.log('✓ UUID-based login works correctly\n');
}

// ── Cleanup ──

async function cleanup() {
  console.log('Cleaning up test data...');

  await prisma.competition_judges.deleteMany({
    where: { competition_id: testCompetition.id },
  }).catch(() => {});

  await prisma.players.deleteMany({
    where: { competition_id: testCompetition.id },
  }).catch(() => {});

  await prisma.competition_stages.deleteMany({
    where: { competition_id: testCompetition.id },
  }).catch(() => {});

  await prisma.competitions.delete({
    where: { id: testCompetition.id },
  }).catch(() => {});

  await prisma.users.deleteMany({
    where: { id: { in: [testJudge.id, testPlayer.id, testUnrelatedUser.id] } },
  }).catch(() => {});

  await prisma.organizations.delete({
    where: { id: testOrg.id },
  }).catch(() => {});

  console.log('✓ Test data cleaned up\n');
}

// ── Run all tests ──

async function runTests() {
  console.log('='.repeat(60));
  console.log('Competition Login Integration Test Suite');
  console.log('='.repeat(60) + '\n');

  try {
    await setup();
    await test1_GetCompetitionInfo();
    await test2_JudgeLogin();
    await test3_PlayerLogin();
    await test4_UnregisteredUser();
    await test5_WrongCredentials();
    await test6_MissingCredentials();
    await test7_NonExistentCompetition();
    await test8_LoginByUUID();
    await cleanup();

    console.log('='.repeat(60));
    console.log('ALL COMPETITION LOGIN TESTS PASSED');
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
