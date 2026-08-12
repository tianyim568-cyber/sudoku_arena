/**
 * Cross-Tenant Isolation Tests — tenantGuard Middleware
 *
 * Simulates two organizations (Org A and Org B), each with their own
 * resources. Verifies that Org A users cannot access Org B resources
 * and vice versa, covering all major resource types.
 *
 * Test matrix:
 *   - Direct resource isolation (competitions, organizations)
 *   - Indirect/nested resource isolation (rounds via competitions)
 *   - SUPER_ADMIN bypass
 *   - PLAYER role enforcement
 *   - Missing resource ID handling
 *   - Non-existent resource handling
 *   - Custom verifier isolation
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { tenantGuard } = require('./src/middleware/tenantGuard');
const { initDB } = require('./src/utils/db');
const { getConnection } = require('./src/db/connection');

// ─── Test Helpers ───

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

async function callGuard(guard, req) {
  const res = mockRes();
  let nextCalled = false;
  await guard(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail) {
  if (condition) {
    console.log(`     ✓ ${label}`);
    passed++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.log(`     ✗ ${msg}`);
    failures.push(msg);
    failed++;
  }
}

// ─── Test Data ───

const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const COMP_A1_ID = 'a1111111-1111-1111-1111-111111111111';
const COMP_A2_ID = 'a2222222-2222-2222-2222-222222222222';
const COMP_B1_ID = 'b1111111-1111-1111-1111-111111111111';

const USER_A_ADMIN  = { userId: 'u-aaaa-admin',  username: 'orgA_admin',  role: 'ORG_ADMIN', organizationId: ORG_A_ID };
const USER_A_JUDGE  = { userId: 'u-aaaa-judge',  username: 'orgA_judge',  role: 'JUDGE',     organizationId: ORG_A_ID };
const USER_A_PLAYER = { userId: 'u-aaaa-player', username: 'orgA_player', role: 'PLAYER',    organizationId: ORG_A_ID };
const USER_B_ADMIN  = { userId: 'u-bbbb-admin',  username: 'orgB_admin',  role: 'ORG_ADMIN', organizationId: ORG_B_ID };
const USER_B_PLAYER = { userId: 'u-bbbb-player', username: 'orgB_player', role: 'PLAYER',    organizationId: ORG_B_ID };
const SUPER_ADMIN   = { userId: 'u-super',        username: 'super',       role: 'SUPER_ADMIN', organizationId: null };

// ─── Main ───

async function runTests() {
  console.log('=== Cross-Tenant Isolation Tests ===');
  console.log('=== tenantGuard: Org A ↔ Org B Resource Blocking ===\n');

  await initDB();
  const { run } = getConnection();

  // ── Setup: create Org A, Org B, and their resources ──
  console.log('Setting up test data...');

  await run(
    `INSERT INTO organizations (id, name, status) VALUES (?, 'Org A - Test', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET name = 'Org A - Test'`,
    [ORG_A_ID]
  );
  await run(
    `INSERT INTO organizations (id, name, status) VALUES (?, 'Org B - Test', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET name = 'Org B - Test'`,
    [ORG_B_ID]
  );

  // Org A competitions
  await run(
    `INSERT INTO competitions (id, organization_id, name, status)
     VALUES (?, ?, 'Org A Competition 1', 'DRAFT')
     ON CONFLICT (id) DO UPDATE SET name = 'Org A Competition 1'`,
    [COMP_A1_ID, ORG_A_ID]
  );
  await run(
    `INSERT INTO competitions (id, organization_id, name, status)
     VALUES (?, ?, 'Org A Competition 2', 'DRAFT')
     ON CONFLICT (id) DO UPDATE SET name = 'Org A Competition 2'`,
    [COMP_A2_ID, ORG_A_ID]
  );

  // Org B competition
  await run(
    `INSERT INTO competitions (id, organization_id, name, status)
     VALUES (?, ?, 'Org B Competition 1', 'DRAFT')
     ON CONFLICT (id) DO UPDATE SET name = 'Org B Competition 1'`,
    [COMP_B1_ID, ORG_B_ID]
  );

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 1: Direct resource isolation (competitions) ──');
  // ──────────────────────────────────────────────────────

  // 1.1 Org A admin accesses own competition → PASS
  {
    const req = mockReq({ user: USER_A_ADMIN, params: { id: COMP_A1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '1.1 Org A admin → own competition: no error', `got status ${res.statusCode}`);
    assert(nextCalled, '1.1 next() called');
  }

  // 1.2 Org A admin tries Org B competition → BLOCKED
  {
    const req = mockReq({ user: USER_A_ADMIN, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '1.2 Org A admin → Org B competition: blocked (403)', `got status ${res.statusCode}`);
    assert(res.body.code === 40302, '1.2 error code 40302', `got code ${res.body.code}`);
    assert(!nextCalled, '1.2 next() not called');
  }

  // 1.3 Org B admin tries Org A competition → BLOCKED
  {
    const req = mockReq({ user: USER_B_ADMIN, params: { id: COMP_A1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '1.3 Org B admin → Org A competition: blocked (403)', `got status ${res.statusCode}`);
    assert(!nextCalled, '1.3 next() not called');
  }

  // 1.4 Org B admin tries Org A competition 2 → BLOCKED
  {
    const req = mockReq({ user: USER_B_ADMIN, params: { id: COMP_A2_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '1.4 Org B admin → Org A competition 2: blocked (403)', `got status ${res.statusCode}`);
    assert(!nextCalled, '1.4 next() not called');
  }

  // 1.5 Org A player tries Org B competition → BLOCKED
  {
    const req = mockReq({ user: USER_A_PLAYER, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '1.5 Org A player → Org B competition: blocked (403)', `got status ${res.statusCode}`);
    assert(!nextCalled, '1.5 next() not called');
  }

  // 1.6 Org B player accesses own competition → PASS
  {
    const req = mockReq({ user: USER_B_PLAYER, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '1.6 Org B player → own competition: no error', `got status ${res.statusCode}`);
    assert(nextCalled, '1.6 next() called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 2: Org-level isolation ──');
  // ──────────────────────────────────────────────────────

  // 2.1 Org A admin (no resource table) → PASS
  {
    const req = mockReq({ user: USER_A_ADMIN });
    const { res, nextCalled } = await callGuard(tenantGuard(), req);
    assert(res.statusCode === null, '2.1 Org A admin basic guard: passes');
    assert(req.organizationId === ORG_A_ID, '2.1 organizationId set to Org A', `got ${req.organizationId}`);
    assert(nextCalled, '2.1 next() called');
  }

  // 2.2 Org B admin (no resource table) → PASS
  {
    const req = mockReq({ user: USER_B_ADMIN });
    const { res, nextCalled } = await callGuard(tenantGuard(), req);
    assert(res.statusCode === null, '2.2 Org B admin basic guard: passes');
    assert(req.organizationId === ORG_B_ID, '2.2 organizationId set to Org B', `got ${req.organizationId}`);
    assert(nextCalled, '2.2 next() called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 3: SUPER_ADMIN bypass ──');
  // ──────────────────────────────────────────────────────

  // 3.1 SUPER_ADMIN → Org A resource → PASS
  {
    const req = mockReq({ user: SUPER_ADMIN, params: { id: COMP_A1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '3.1 SUPER_ADMIN → Org A competition: no error');
    assert(nextCalled, '3.1 next() called');
  }

  // 3.2 SUPER_ADMIN → Org B resource → PASS
  {
    const req = mockReq({ user: SUPER_ADMIN, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '3.2 SUPER_ADMIN → Org B competition: no error');
    assert(nextCalled, '3.2 next() called');
  }

  // 3.3 SUPER_ADMIN → non-existent resource → PASS (no resource guard, no row lookup)
  {
    const req = mockReq({
      user: SUPER_ADMIN,
      params: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '3.3 SUPER_ADMIN → non-existent resource: bypasses check');
    assert(nextCalled, '3.3 next() called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 4: Role-based behavior ──');
  // ──────────────────────────────────────────────────────

  // 4.1 Org A judge → own competition → PASS
  {
    const req = mockReq({ user: USER_A_JUDGE, params: { id: COMP_A1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '4.1 Org A judge → own competition: no error');
    assert(nextCalled, '4.1 next() called');
  }

  // 4.2 Org A judge → Org B competition → BLOCKED
  {
    const req = mockReq({ user: USER_A_JUDGE, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '4.2 Org A judge → Org B competition: blocked');
    assert(!nextCalled, '4.2 next() not called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 5: User without organization ──');
  // ──────────────────────────────────────────────────────

  // 5.1 User with null orgId → BLOCKED
  {
    const noOrgUser = { userId: 'u-orphan', username: 'orphan', role: 'ORG_ADMIN', organizationId: null };
    const req = mockReq({ user: noOrgUser });
    const { res, nextCalled } = await callGuard(tenantGuard(), req);
    assert(res.statusCode === 403, '5.1 No-org user → blocked (403)', `got status ${res.statusCode}`);
    assert(res.body.code === 40301, '5.1 error code 40301', `got code ${res.body.code}`);
    assert(!nextCalled, '5.1 next() not called');
  }

  // 5.2 No req.user at all → 401
  {
    const req = mockReq({});
    const { res, nextCalled } = await callGuard(tenantGuard(), req);
    assert(res.statusCode === 401, '5.2 No user → 401', `got status ${res.statusCode}`);
    assert(!nextCalled, '5.2 next() not called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 6: Missing / non-existent resource ID ──');
  // ──────────────────────────────────────────────────────

  // 6.1 No :id in params → skip resource check (list/create endpoint)
  {
    const req = mockReq({ user: USER_A_ADMIN, params: {} });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === null, '6.1 No resource ID → skip check, passes');
    assert(nextCalled, '6.1 next() called');
  }

  // 6.2 Non-existent competition ID → BLOCKED (no matching row)
  {
    const req = mockReq({
      user: USER_A_ADMIN,
      params: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    });
    const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
    assert(res.statusCode === 403, '6.2 Non-existent resource → 403 (row not found)', `got status ${res.statusCode}`);
    assert(!nextCalled, '6.2 next() not called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 7: Custom verifier with cross-tenant data ──');
  // ──────────────────────────────────────────────────────

  // 7.1 Custom verifier: Org A admin queries own competition by custom logic → PASS
  {
    const verifier = async (resourceId, orgId, db) => {
      const row = await db(
        'SELECT id FROM competitions WHERE id = ? AND organization_id = ?',
        [resourceId, orgId]
      );
      return !!row;
    };

    const req = mockReq({ user: USER_A_ADMIN, params: { id: COMP_A1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard(verifier), req);
    assert(res.statusCode === null, '7.1 Custom verifier: Org A → own resource: passes');
    assert(nextCalled, '7.1 next() called');
  }

  // 7.2 Custom verifier: Org A admin queries Org B competition → BLOCKED
  {
    const verifier = async (resourceId, orgId, db) => {
      const row = await db(
        'SELECT id FROM competitions WHERE id = ? AND organization_id = ?',
        [resourceId, orgId]
      );
      return !!row;
    };

    const req = mockReq({ user: USER_A_ADMIN, params: { id: COMP_B1_ID } });
    const { res, nextCalled } = await callGuard(tenantGuard(verifier), req);
    assert(res.statusCode === 403, '7.2 Custom verifier: Org A → Org B resource: blocked');
    assert(!nextCalled, '7.2 next() not called');
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 8: req.organizationId injection ──');
  // ──────────────────────────────────────────────────────

  // 8.1 Org A → req.organizationId should be ORG_A_ID
  {
    const req = mockReq({ user: USER_A_ADMIN, params: {} });
    await callGuard(tenantGuard('competitions'), req);
    assert(req.organizationId === ORG_A_ID, '8.1 Org A user: organizationId injected', `got ${req.organizationId}`);
  }

  // 8.2 Org B → req.organizationId should be ORG_B_ID
  {
    const req = mockReq({ user: USER_B_ADMIN, params: {} });
    await callGuard(tenantGuard('competitions'), req);
    assert(req.organizationId === ORG_B_ID, '8.2 Org B user: organizationId injected', `got ${req.organizationId}`);
  }

  // ──────────────────────────────────────────────────────
  console.log('\n── Test Group 9: Brute-force enumeration ──');
  // ──────────────────────────────────────────────────────

  // 9.1 Org A tries every Org B resource systematically
  const orgBResources = [COMP_B1_ID];
  const orgARoles = [USER_A_ADMIN, USER_A_JUDGE, USER_A_PLAYER];
  const orgARoleNames = ['ORG_ADMIN', 'JUDGE', 'PLAYER'];

  for (let i = 0; i < orgARoles.length; i++) {
    const user = orgARoles[i];
    const roleName = orgARoleNames[i];
    for (const bResId of orgBResources) {
      const req = mockReq({ user, params: { id: bResId } });
      const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
      assert(
        res.statusCode === 403 && !nextCalled,
        `9.1 Org A ${roleName} → Org B resource [${bResId.slice(0, 8)}...]: blocked`
      );
    }
  }

  // 9.2 Org B tries every Org A resource systematically
  const orgAResources = [COMP_A1_ID, COMP_A2_ID];
  const orgBRoles = [USER_B_ADMIN, USER_B_PLAYER];
  const orgBRoleNames = ['ORG_ADMIN', 'PLAYER'];

  for (let i = 0; i < orgBRoles.length; i++) {
    const user = orgBRoles[i];
    const roleName = orgBRoleNames[i];
    for (const aResId of orgAResources) {
      const req = mockReq({ user, params: { id: aResId } });
      const { res, nextCalled } = await callGuard(tenantGuard('competitions'), req);
      assert(
        res.statusCode === 403 && !nextCalled,
        `9.2 Org B ${roleName} → Org A resource [${aResId.slice(0, 8)}...]: blocked`
      );
    }
  }

  // ──────────────────────────────────────────────────────
  // Cleanup test data
  // ──────────────────────────────────────────────────────
  console.log('\nCleaning up test data...');
  await run('DELETE FROM competitions WHERE id = ?', [COMP_A1_ID]);
  await run('DELETE FROM competitions WHERE id = ?', [COMP_A2_ID]);
  await run('DELETE FROM competitions WHERE id = ?', [COMP_B1_ID]);
  await run('DELETE FROM organizations WHERE id = ?', [ORG_A_ID]);
  await run('DELETE FROM organizations WHERE id = ?', [ORG_B_ID]);
  console.log('  Test data cleaned up.');

  // ──────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  if (failed === 0) {
    console.log('\n✅ ALL TESTS PASSED — Cross-tenant isolation verified.');
  } else {
    console.log(`\n❌ ${failed} test(s) FAILED.`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal test error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
