/**
 * Registration API Test Suite
 *
 * Tests the POST /api/auth/register endpoint.
 * Creates test data via direct HTTP calls, verifies responses, then cleans up.
 *
 * Run: node test-registration.js
 * Requires: server running on localhost:3001 (or reads PORT from .env)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getPrisma, disconnectPrisma } = require('./src/db/prisma');

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://127.0.0.1:${PORT}/api/auth`;

let passed = 0;
let failed = 0;
let prisma;

// Unique test data to avoid collisions
const TEST_PREFIX = `test_${Date.now()}`;
const TEST_ORG_NAME = `${TEST_PREFIX}_org`;
const TEST_ADMIN_USERNAME = `${TEST_PREFIX}_admin`;
const TEST_PASSWORD = 'testpass123';

// Track created IDs for cleanup
const CLEANUP = { orgId: null, userId: null };

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function register(body) {
  const res = await fetch(`${BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

// ── Tests ──

async function testSuccessfulRegistration() {
  console.log('\n=== Test: Successful Registration ===\n');

  const result = await register({
    organizationName: TEST_ORG_NAME,
    adminUsername: TEST_ADMIN_USERNAME,
    password: TEST_PASSWORD,
  });

  assert(result.status === 201, 'returns HTTP 201');
  assert(result.json.code === 200, 'returns code 200');
  assert(result.json.data && result.json.data.token, 'returns JWT token');
  assert(result.json.data && result.json.data.organization, 'returns organization object');
  assert(result.json.data && result.json.data.user, 'returns user object');
  assert(result.json.data.organization.name === TEST_ORG_NAME, 'org name matches');
  assert(result.json.data.user.username === TEST_ADMIN_USERNAME, 'admin username matches');
  assert(result.json.data.user.role === 'ORG_ADMIN', 'admin role is ORG_ADMIN');
  assert(result.json.data.user.organizationId, 'user has organizationId');

  // Save IDs for cleanup
  CLEANUP.orgId = result.json.data.organization.id;
  CLEANUP.userId = result.json.data.user.id;

  // Verify JWT contains organizationId
  const token = result.json.data.token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  assert(payload.organizationId === CLEANUP.orgId, 'JWT contains correct organizationId');
  assert(payload.role === 'ORG_ADMIN', 'JWT contains correct role');
}

async function testDuplicateOrgName() {
  console.log('\n=== Test: Duplicate Organization Name ===\n');

  const result = await register({
    organizationName: TEST_ORG_NAME, // already exists
    adminUsername: `${TEST_PREFIX}_admin2`,
    password: TEST_PASSWORD,
  });

  assert(result.json.code === 40003, 'returns code 40003');
  assert(result.json.message.includes('组织名称已存在'), 'message says org name exists');
}

async function testDuplicateAdminUsername() {
  console.log('\n=== Test: Duplicate Admin Username ===\n');

  const result = await register({
    organizationName: `${TEST_PREFIX}_org2`,
    adminUsername: TEST_ADMIN_USERNAME, // already exists
    password: TEST_PASSWORD,
  });

  assert(result.json.code === 40003, 'returns code 40003');
  assert(result.json.message.includes('用户名已存在'), 'message says username exists');
}

async function testMissingFields() {
  console.log('\n=== Test: Missing Required Fields ===\n');

  // Missing all
  const r1 = await register({});
  assert(r1.json.code === 40001, 'missing all fields → code 40001');

  // Missing password
  const r2 = await register({ organizationName: 'test', adminUsername: 'test' });
  assert(r2.json.code === 40001, 'missing password → code 40001');

  // Missing org name
  const r3 = await register({ adminUsername: 'test', password: 'test123' });
  assert(r3.json.code === 40001, 'missing org name → code 40001');

  // Missing admin username
  const r4 = await register({ organizationName: 'test', password: 'test123' });
  assert(r4.json.code === 40001, 'missing admin username → code 40001');
}

async function testValidationRules() {
  console.log('\n=== Test: Validation Rules ===\n');

  // Org name too short
  const r1 = await register({
    organizationName: 'A',
    adminUsername: `${TEST_PREFIX}_val1`,
    password: TEST_PASSWORD,
  });
  assert(r1.json.code === 40001, 'org name < 2 chars → code 40001');

  // Password too short
  const r2 = await register({
    organizationName: `${TEST_PREFIX}_val_org`,
    adminUsername: `${TEST_PREFIX}_val2`,
    password: '123',
  });
  assert(r2.json.code === 40001, 'password < 6 chars → code 40001');
}

async function testLoginAfterRegistration() {
  console.log('\n=== Test: Login After Registration ===\n');

  const result = await login(TEST_ADMIN_USERNAME, TEST_PASSWORD);

  assert(result.json.code === 200, 'login succeeds with code 200');
  assert(result.json.data && result.json.data.token, 'login returns token');
  assert(result.json.data.user.username === TEST_ADMIN_USERNAME, 'login returns correct user');
  assert(result.json.data.user.organizationId === CLEANUP.orgId, 'login returns correct org ID');
}

async function testLoginWithWrongPassword() {
  console.log('\n=== Test: Login With Wrong Password ===\n');

  const result = await login(TEST_ADMIN_USERNAME, 'wrongpassword');

  assert(result.json.code === 40001, 'wrong password → code 40001');
  assert(!result.json.data || !result.json.data.token, 'no token returned');
}

// ── Cleanup ──

async function cleanup() {
  console.log('\n=== Cleanup ===\n');

  try {
    if (CLEANUP.userId) {
      await prisma.users.delete({ where: { id: CLEANUP.userId } }).catch(() => {});
    }
    // Delete any other test users that were created
    await prisma.users.deleteMany({
      where: { username: { startsWith: TEST_PREFIX } },
    }).catch(() => {});

    if (CLEANUP.orgId) {
      await prisma.organizations.delete({ where: { id: CLEANUP.orgId } }).catch(() => {});
    }
    // Delete any other test orgs
    await prisma.organizations.deleteMany({
      where: { name: { startsWith: TEST_PREFIX } },
    }).catch(() => {});

    console.log('  Test data cleaned up');
  } catch (e) {
    console.error('  Cleanup error:', e.message);
  }
}

// ── Main ──

async function main() {
  console.log('========================================');
  console.log('  Registration API Test Suite');
  console.log('========================================');
  console.log(`  Endpoint: ${BASE_URL}/register`);

  // Verify server is running
  try {
    const health = await fetch(`http://localhost:${PORT}/api/health`);
    if (!health.ok) throw new Error(`Health check returned ${health.status}`);
    console.log('  Server: reachable');
  } catch (e) {
    console.error(`\nServer not reachable on port ${PORT}. Start it with: node src/index.js`);
    process.exit(1);
  }

  prisma = getPrisma();

  try {
    await testSuccessfulRegistration();
    await testDuplicateOrgName();
    await testDuplicateAdminUsername();
    await testMissingFields();
    await testValidationRules();
    await testLoginAfterRegistration();
    await testLoginWithWrongPassword();

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

    console.log('\n========================================');
    console.log('  Registration Test Report');
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
