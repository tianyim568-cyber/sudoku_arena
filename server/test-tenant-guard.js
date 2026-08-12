/**
 * tenantGuard Middleware — Unit Tests
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { tenantGuard } = require('./src/middleware/tenantGuard');
const { initDB, getRepos } = require('./src/utils/db');

// Mock Express req/res/next
function mockReq(overrides) {
  return {
    user: null,
    params: {},
    query: {},
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

let passCount = 0;
let failCount = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`   ✓ ${label}`);
    passCount++;
  } else {
    console.log(`   ✗ ${label}`);
    failCount++;
  }
}

async function runTests() {
  console.log('=== tenantGuard Middleware Tests ===\n');

  await initDB();
  const repos = getRepos();

  // ── Test 1: No req.user → 401 ──
  console.log('1. Unauthenticated request');
  {
    const req = mockReq({});
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard()(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401, 'returns 401 when no user');
    assert(res.body.code === 40101, 'error code is 40101');
    assert(!nextCalled, 'next() not called');
  }

  // ── Test 2: SUPER_ADMIN bypasses tenant check ──
  console.log('\n2. SUPER_ADMIN bypass');
  {
    const req = mockReq({
      user: { userId: 'x', username: 'admin', role: 'SUPER_ADMIN', organizationId: null },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard()(req, res, () => { nextCalled = true; });
    assert(res.statusCode === null, 'no error status');
    assert(req.organizationId === null, 'organizationId set to null');
    assert(nextCalled, 'next() called');
  }

  // ── Test 3: ORG_ADMIN with valid orgId passes org check ──
  console.log('\n3. ORG_ADMIN with organization');
  {
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';
    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: orgId },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard()(req, res, () => { nextCalled = true; });
    assert(res.statusCode === null, 'no error status');
    assert(req.organizationId === orgId, 'organizationId set correctly');
    assert(nextCalled, 'next() called');
  }

  // ── Test 4: ORG_ADMIN with no orgId → 403 ──
  console.log('\n4. ORG_ADMIN without organization');
  {
    const req = mockReq({
      user: { userId: 'z', username: 'orphan', role: 'ORG_ADMIN', organizationId: null },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard()(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403, 'returns 403 when no org');
    assert(res.body.code === 40301, 'error code is 40301');
    assert(!nextCalled, 'next() not called');
  }

  // ── Test 5: Resource guard — org owns competition → passes ──
  console.log('\n5. Resource guard — owned resource');
  {
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';
    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: orgId },
      params: { id: '11111111-1111-1111-1111-111111111111' },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard('competitions')(req, res, () => { nextCalled = true; });
    assert(res.statusCode === null, 'no error (org owns this competition)');
    assert(nextCalled, 'next() called');
  }

  // ── Test 6: Resource guard — different org's competition → 403 ──
  console.log('\n6. Resource guard — foreign resource');
  {
    const fakeOrgId = '99999999-9999-9999-9999-999999999999';
    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: fakeOrgId },
      params: { id: '11111111-1111-1111-1111-111111111111' },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard('competitions')(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403, 'returns 403 for foreign resource');
    assert(res.body.code === 40302, 'error code is 40302');
    assert(!nextCalled, 'next() not called');
  }

  // ── Test 7: SUPER_ADMIN can access any resource ──
  console.log('\n7. SUPER_ADMIN accessing foreign resource');
  {
    const req = mockReq({
      user: { userId: 'x', username: 'admin', role: 'SUPER_ADMIN', organizationId: null },
      params: { id: '11111111-1111-1111-1111-111111111111' },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard('competitions')(req, res, () => { nextCalled = true; });
    assert(res.statusCode === null, 'no error for super admin');
    assert(nextCalled, 'next() called');
  }

  // ── Test 8: No resource ID in params → skip check (list/create) ──
  console.log('\n8. No resource ID in request (list/create)');
  {
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';
    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: orgId },
      params: {},
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard('competitions')(req, res, () => { nextCalled = true; });
    assert(res.statusCode === null, 'no error when no resource ID');
    assert(nextCalled, 'next() called');
  }

  // ── Test 9: Custom verifier function ──
  console.log('\n9. Custom verifier function');
  {
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';
    let verifierCalled = false;
    let verifierArgs = null;
    const customVerifier = async (resourceId, oid, db) => {
      verifierCalled = true;
      verifierArgs = { resourceId, orgId: oid };
      return true;
    };

    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: orgId },
      params: { id: 'some-id' },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard(customVerifier)(req, res, () => { nextCalled = true; });
    assert(verifierCalled, 'custom verifier was called');
    assert(verifierArgs.resourceId === 'some-id', 'resourceId passed correctly');
    assert(verifierArgs.orgId === orgId, 'orgId passed correctly');
    assert(nextCalled, 'next() called (verifier returned true)');
  }

  // ── Test 10: Custom verifier returning false → 403 ──
  console.log('\n10. Custom verifier returning false');
  {
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';
    const req = mockReq({
      user: { userId: 'y', username: 'judge', role: 'ORG_ADMIN', organizationId: orgId },
      params: { id: 'some-id' },
    });
    const res = mockRes();
    let nextCalled = false;
    await tenantGuard(async () => false)(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403, 'returns 403 when verifier returns false');
    assert(!nextCalled, 'next() not called');
  }

  // ── Summary ──
  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
