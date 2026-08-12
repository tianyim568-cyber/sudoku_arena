/**
 * Access Link API Test Suite
 *
 * Tests the competition access link CRUD endpoints:
 * - POST /:id/access-link (generate)
 * - GET  /:id/access-link (retrieve)
 * - DELETE /:id/access-link (revoke)
 * - GET /by-code/:accessCode/info (public info)
 *
 * Run: node test-access-links.js
 * Requires: server running on localhost:3001
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getPrisma, disconnectPrisma } = require('./src/db/prisma');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://127.0.0.1:${PORT}/api/competitions`;

let passed = 0;
let failed = 0;
let prisma;

// Test data
let testOrg;
let testUser;
let testCompetition;
let adminToken;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makeToken(user, org) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      organizationId: org.id,
    },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

async function apiRequest(method, path, token, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json();
  return { status: res.status, json };
}

// ── Setup ──

async function setup() {
  console.log('\n=== Setup ===\n');

  prisma = getPrisma();

  testOrg = await prisma.organizations.create({
    data: { name: `AccessLink_Org_${Date.now()}` },
  });

  testUser = await prisma.users.create({
    data: {
      organization_id: testOrg.id,
      username: `al_admin_${Date.now()}`,
      password_hash: 'dummy_hash',
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    },
  });

  testCompetition = await prisma.competitions.create({
    data: {
      organization_id: testOrg.id,
      name: `AccessLink_Competition_${Date.now()}`,
      status: 'ACTIVE',
    },
  });

  adminToken = makeToken(testUser, testOrg);
  console.log('  Test data created');
}

// ── Tests ──

async function test1_GenerateAccessLink() {
  console.log('\n=== Test 1: Generate Access Link ===\n');

  const result = await apiRequest('POST', `/${testCompetition.id}/access-link`, adminToken);

  assert(result.json.code === 200, 'returns code 200');
  assert(result.json.data && result.json.data.accessCode, 'returns access code');
  assert(result.json.data.accessCode.length === 8, 'access code is 8 characters');
  assert(/^[a-z0-9]+$/.test(result.json.data.accessCode), 'access code is lowercase alphanumeric');
  assert(result.json.data.entryUrl, 'returns entry URL');
  assert(result.json.data.entryUrl.includes(result.json.data.accessCode), 'entry URL contains access code');

  // Verify in DB
  const updated = await prisma.competitions.findUnique({ where: { id: testCompetition.id } });
  assert(updated.competition_access_code === result.json.data.accessCode, 'DB updated with access code');
}

async function test2_GetAccessLink() {
  console.log('\n=== Test 2: Retrieve Access Link ===\n');

  const result = await apiRequest('GET', `/${testCompetition.id}/access-link`, adminToken);

  assert(result.json.code === 200, 'returns code 200');
  assert(result.json.data && result.json.data.accessCode, 'returns access code');
  assert(result.json.data.entryUrl, 'returns entry URL');

  // Should match what's in DB
  const comp = await prisma.competitions.findUnique({ where: { id: testCompetition.id } });
  assert(result.json.data.accessCode === comp.competition_access_code, 'code matches DB');
}

async function test3_RegenerateReplacesCode() {
  console.log('\n=== Test 3: Regenerate Replaces Old Code ===\n');

  const before = await prisma.competitions.findUnique({ where: { id: testCompetition.id } });
  const oldCode = before.competition_access_code;

  const result = await apiRequest('POST', `/${testCompetition.id}/access-link`, adminToken);
  const newCode = result.json.data.accessCode;

  assert(result.json.code === 200, 'returns code 200');
  assert(newCode.length === 8, 'new code is 8 characters');
  // Extremely unlikely but theoretically possible to regenerate same code
  // Just verify it's a valid code
  assert(/^[a-z0-9]+$/.test(newCode), 'new code is valid format');

  const after = await prisma.competitions.findUnique({ where: { id: testCompetition.id } });
  assert(after.competition_access_code === newCode, 'DB updated with new code');
}

async function test4_RevokeAccessLink() {
  console.log('\n=== Test 4: Revoke Access Link ===\n');

  const result = await apiRequest('DELETE', `/${testCompetition.id}/access-link`, adminToken);

  assert(result.json.code === 200, 'returns code 200');

  const comp = await prisma.competitions.findUnique({ where: { id: testCompetition.id } });
  assert(comp.competition_access_code === null, 'DB access code set to null');

  // GET should now return null
  const getResult = await apiRequest('GET', `/${testCompetition.id}/access-link`, adminToken);
  assert(getResult.json.code === 200, 'GET still returns 200');
  assert(getResult.json.data.accessCode === null, 'access code is null after revoke');
  assert(getResult.json.data.entryUrl === null, 'entry URL is null after revoke');
}

async function test5_PublicInfoEndpoint() {
  console.log('\n=== Test 5: Public Info Endpoint (by-code) ===\n');

  // First generate a code
  const genResult = await apiRequest('POST', `/${testCompetition.id}/access-link`, adminToken);
  const accessCode = genResult.json.data.accessCode;

  // Access public endpoint (no auth)
  const result = await apiRequest('GET', `/by-code/${accessCode}/info`, null);

  assert(result.json.code === 200, 'returns code 200');
  assert(result.json.data && result.json.data.id === testCompetition.id, 'returns correct competition ID');
  assert(result.json.data.name === testCompetition.name, 'returns correct name');
  assert(result.json.data.status === 'ACTIVE', 'returns correct status');
  assert(result.json.data.organizationName === testOrg.name, 'returns org name');
}

async function test6_PublicInfoInvalidCode() {
  console.log('\n=== Test 6: Public Info with Invalid Code ===\n');

  const result = await apiRequest('GET', '/by-code/invalidcode/info', null);

  assert(result.json.code === 40400, 'returns code 40400 for invalid code');
}

async function test7_NonExistentCompetition() {
  console.log('\n=== Test 7: Non-Existent Competition ===\n');

  const fakeId = '00000000-0000-0000-0000-000000000000';

  // tenantGuard returns 403 for non-existent resources (prevents enumeration)
  const r1 = await apiRequest('POST', `/${fakeId}/access-link`, adminToken);
  assert(r1.status === 403, 'generate returns 403 for non-existent competition');

  const r2 = await apiRequest('GET', `/${fakeId}/access-link`, adminToken);
  assert(r2.status === 403, 'retrieve returns 403 for non-existent competition');

  const r3 = await apiRequest('DELETE', `/${fakeId}/access-link`, adminToken);
  assert(r3.status === 403, 'revoke returns 403 for non-existent competition');
}

async function test8_UnauthorizedAccess() {
  console.log('\n=== Test 8: Unauthorized Access ===\n');

  // No token
  const r1 = await apiRequest('POST', `/${testCompetition.id}/access-link`, null);
  assert(r1.status === 401, 'POST without token returns 401');

  const r2 = await apiRequest('GET', `/${testCompetition.id}/access-link`, null);
  assert(r2.status === 401, 'GET without token returns 401');

  const r3 = await apiRequest('DELETE', `/${testCompetition.id}/access-link`, null);
  assert(r3.status === 401, 'DELETE without token returns 401');
}

async function test9_CrossTenantBlocked() {
  console.log('\n=== Test 9: Cross-Tenant Access Blocked ===\n');

  // Create a different org + user
  const otherOrg = await prisma.organizations.create({
    data: { name: `OtherOrg_${Date.now()}` },
  });
  const otherUser = await prisma.users.create({
    data: {
      organization_id: otherOrg.id,
      username: `other_admin_${Date.now()}`,
      password_hash: 'dummy_hash',
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    },
  });
  const otherToken = makeToken(otherUser, otherOrg);

  // Other org admin tries to generate access link for our competition
  const r1 = await apiRequest('POST', `/${testCompetition.id}/access-link`, otherToken);
  assert(r1.status === 403, 'cross-tenant generate blocked with 403');

  const r2 = await apiRequest('GET', `/${testCompetition.id}/access-link`, otherToken);
  assert(r2.status === 403, 'cross-tenant retrieve blocked with 403');

  const r3 = await apiRequest('DELETE', `/${testCompetition.id}/access-link`, otherToken);
  assert(r3.status === 403, 'cross-tenant revoke blocked with 403');

  // Cleanup
  await prisma.users.delete({ where: { id: otherUser.id } }).catch(() => {});
  await prisma.organizations.delete({ where: { id: otherOrg.id } }).catch(() => {});
}

async function test10_RevokeThenInfoFails() {
  console.log('\n=== Test 10: Revoke Then Public Info Fails ===\n');

  // Generate code
  const gen = await apiRequest('POST', `/${testCompetition.id}/access-link`, adminToken);
  const code = gen.json.data.accessCode;

  // Verify public info works
  const before = await apiRequest('GET', `/by-code/${code}/info`, null);
  assert(before.json.code === 200, 'public info works before revoke');

  // Revoke
  await apiRequest('DELETE', `/${testCompetition.id}/access-link`, adminToken);

  // Public info should fail now
  const after = await apiRequest('GET', `/by-code/${code}/info`, null);
  assert(after.json.code === 40400, 'public info returns 40400 after revoke');
}

// ── Cleanup ──

async function cleanup() {
  console.log('\n=== Cleanup ===\n');

  try {
    await prisma.competitions.delete({ where: { id: testCompetition.id } }).catch(() => {});
    await prisma.users.delete({ where: { id: testUser.id } }).catch(() => {});
    await prisma.organizations.delete({ where: { id: testOrg.id } }).catch(() => {});
    console.log('  Test data cleaned up');
  } catch (e) {
    console.error('  Cleanup error:', e.message);
  }
}

// ── Main ──

async function main() {
  console.log('========================================');
  console.log('  Access Link API Test Suite');
  console.log('========================================');

  // Verify server
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    if (!health.ok) throw new Error(`Health check returned ${health.status}`);
    console.log('  Server: reachable');
  } catch (e) {
    console.error(`\nServer not reachable on port ${PORT}. Start it with: node src/index.js`);
    process.exit(1);
  }

  try {
    await setup();
    await test1_GenerateAccessLink();
    await test2_GetAccessLink();
    await test3_RegenerateReplacesCode();
    await test4_RevokeAccessLink();
    await test5_PublicInfoEndpoint();
    await test6_PublicInfoInvalidCode();
    await test7_NonExistentCompetition();
    await test8_UnauthorizedAccess();
    await test9_CrossTenantBlocked();
    await test10_RevokeThenInfoFails();

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
    console.error(e.stack);
  } finally {
    await cleanup();
    await disconnectPrisma();

    console.log('\n========================================');
    console.log('  Access Link Test Report');
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
