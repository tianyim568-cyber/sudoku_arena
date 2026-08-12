const http = require('http');
const jwt = require('jsonwebtoken');

const BASE_URL = 'http://localhost:3001';
const JWT_SECRET = 'sudoku-arena-secret-key';

let orgToken = '';
let compToken = '';
let testOrgId = '';
let testUserId = '';
let testUsername = '';
let testCompetitionId = '';
let testParticipantId = '';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('UNIFIED AUTH MIDDLEWARE TESTS');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;
  const uniqueId = Date.now();

  // Setup: Create test organization and user
  console.log('\n[Setup] Creating test data...');
  try {
    const res = await request('POST', '/api/auth/register', {
      organizationName: `Auth Test Org ${uniqueId}`,
      adminUsername: `auth_test_${uniqueId}`,
      password: 'testpass123'
    });
    if (res.status === 201 && res.data.code === 200) {
      orgToken = res.data.data.token;
      testOrgId = res.data.data.organization.id;
      testUserId = res.data.data.user.id;
      testUsername = res.data.data.user.username;
      console.log('  ✓ Test organization and user created');
      console.log(`    Org: ${testOrgId}`);
      console.log(`    User: ${testUserId}`);
    } else {
      console.log('  ✗ Failed to create test data');
      process.exit(1);
    }
  } catch (e) {
    console.log('  ✗ Setup failed:', e.message);
    process.exit(1);
  }

  // Setup: Create test competition and participant
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const comp = await prisma.competitions.create({
      data: {
        name: 'Auth Test Competition',
        organization_id: testOrgId,
        status: 'DRAFT',
      }
    });
    testCompetitionId = comp.id;

    const participant = await prisma.players.create({
      data: {
        competition_id: testCompetitionId,
        user_id: testUserId,
        name: 'Test Player',
      }
    });
    testParticipantId = participant.id;

    console.log('  ✓ Test competition and participant created');
    console.log(`    Competition: ${testCompetitionId}`);
    console.log(`    Participant: ${testParticipantId}`);
    await prisma.$disconnect();
  } catch (e) {
    console.log('  ✗ Failed to create competition data:', e.message);
    process.exit(1);
  }

  // Setup: Generate competition-scoped token
  try {
    compToken = jwt.sign({
      type: 'competition',
      competitionId: testCompetitionId,
      userId: testUserId,
      role: 'PLAYER',
      participantId: testParticipantId,
      organizationId: testOrgId,
    }, JWT_SECRET, { expiresIn: '1h' });
    console.log('  ✓ Competition token generated');
  } catch (e) {
    console.log('  ✗ Failed to generate competition token:', e.message);
    process.exit(1);
  }

  // Test 1: Org token with /api/auth/me
  console.log('\n[Test 1] GET /api/auth/me with org token');
  try {
    const res = await request('GET', '/api/auth/me', null, orgToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: Org token works');
      console.log(`    User ID: ${res.data.data.id}`);
      console.log(`    Role: ${res.data.data.role}`);
      console.log(`    Org ID: ${res.data.data.organizationId}`);
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 2: Competition token with /api/auth/me
  console.log('\n[Test 2] GET /api/auth/me with competition token');
  try {
    const res = await request('GET', '/api/auth/me', null, compToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: Competition token works with auth middleware');
      console.log(`    User ID: ${res.data.data.id}`);
      console.log(`    Username: ${res.data.data.username || '(null)'}`);
      console.log(`    Role: ${res.data.data.role}`);
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 3: Org token with roleMiddleware (ORG_ADMIN)
  console.log('\n[Test 3] POST /api/competitions/:id/access-link with org token');
  try {
    const res = await request('POST', `/api/competitions/${testCompetitionId}/access-link`, null, orgToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: Org token with ORG_ADMIN role accepted');
      console.log(`    Access code: ${res.data.data.accessCode}`);
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 4: Competition token with roleMiddleware (should fail - PLAYER != ORG_ADMIN)
  console.log('\n[Test 4] POST /api/competitions/:id/access-link with competition token');
  try {
    const res = await request('POST', `/api/competitions/${testCompetitionId}/access-link`, null, compToken);
    if (res.status === 403 && res.data.code === 40301) {
      console.log('  ✓ PASS: Competition token (PLAYER role) rejected by roleMiddleware');
      console.log(`    Message: ${res.data.message}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Expected 403, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 5: Decode and verify org token structure
  console.log('\n[Test 5] Verify org token payload structure');
  try {
    const decoded = jwt.decode(orgToken);
    const hasRequiredFields = decoded.userId && decoded.username && decoded.role && decoded.organizationId;
    const noTypeField = !decoded.type || decoded.type !== 'competition';
    if (hasRequiredFields && noTypeField) {
      console.log('  ✓ PASS: Org token has correct structure');
      console.log(`    userId: ${decoded.userId}`);
      console.log(`    username: ${decoded.username}`);
      console.log(`    role: ${decoded.role}`);
      console.log(`    organizationId: ${decoded.organizationId}`);
      console.log(`    type: ${decoded.type || '(not set)'}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Org token structure incorrect');
      console.log(`    Decoded: ${JSON.stringify(decoded)}`);
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 6: Decode and verify competition token structure
  console.log('\n[Test 6] Verify competition token payload structure');
  try {
    const decoded = jwt.decode(compToken);
    const hasRequiredFields = decoded.type === 'competition' && decoded.competitionId && decoded.userId && decoded.role && decoded.participantId && decoded.organizationId;
    if (hasRequiredFields) {
      console.log('  ✓ PASS: Competition token has correct structure');
      console.log(`    type: ${decoded.type}`);
      console.log(`    competitionId: ${decoded.competitionId}`);
      console.log(`    userId: ${decoded.userId}`);
      console.log(`    role: ${decoded.role}`);
      console.log(`    participantId: ${decoded.participantId}`);
      console.log(`    organizationId: ${decoded.organizationId}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Competition token structure incorrect');
      console.log(`    Decoded: ${JSON.stringify(decoded)}`);
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 7: Create ORG_ADMIN competition token and test access
  console.log('\n[Test 7] Test competition token with ORG_ADMIN role');
  try {
    const adminCompToken = jwt.sign({
      type: 'competition',
      competitionId: testCompetitionId,
      userId: testUserId,
      role: 'ORG_ADMIN',
      participantId: null,
      organizationId: testOrgId,
    }, JWT_SECRET, { expiresIn: '1h' });

    const res = await request('POST', `/api/competitions/${testCompetitionId}/access-link`, null, adminCompToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: Competition token with ORG_ADMIN role accepted');
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 8: Test tenantGuard with org token
  console.log('\n[Test 8] Test tenantGuard with org token');
  try {
    const res = await request('GET', `/api/competitions/${testCompetitionId}/access-link`, null, orgToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: tenantGuard works with org token');
      console.log(`    Access code retrieved: ${res.data.data.accessCode}`);
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 9: Test tenantGuard with competition token (ORG_ADMIN)
  console.log('\n[Test 9] Test tenantGuard with competition token');
  try {
    const adminCompToken = jwt.sign({
      type: 'competition',
      competitionId: testCompetitionId,
      userId: testUserId,
      role: 'ORG_ADMIN',
      participantId: null,
      organizationId: testOrgId,
    }, JWT_SECRET, { expiresIn: '1h' });

    const res = await request('GET', `/api/competitions/${testCompetitionId}/access-link`, null, adminCompToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  ✓ PASS: tenantGuard works with competition token');
      passed++;
    } else {
      console.log('  ✗ FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 10: Test expired token
  console.log('\n[Test 10] Test expired token');
  try {
    const expiredToken = jwt.sign({
      userId: testUserId,
      username: testUsername,
      role: 'ORG_ADMIN',
      organizationId: testOrgId,
    }, JWT_SECRET, { expiresIn: '0s' });

    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await request('GET', '/api/auth/me', null, expiredToken);
    if (res.status === 401 && res.data.code === 40102) {
      console.log('  ✓ PASS: Expired token rejected');
      console.log(`    Message: ${res.data.message}`);
      passed++;
    } else {
      console.log('  ✗ FAIL: Expected 401, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 11: Test token with wrong secret
  console.log('\n[Test 11] Test token with wrong secret');
  try {
    const wrongSecretToken = jwt.sign({
      userId: testUserId,
      username: testUsername,
      role: 'ORG_ADMIN',
      organizationId: testOrgId,
    }, 'wrong-secret', { expiresIn: '1h' });

    const res = await request('GET', '/api/auth/me', null, wrongSecretToken);
    if (res.status === 401 && res.data.code === 40102) {
      console.log('  ✓ PASS: Token with wrong secret rejected');
      passed++;
    } else {
      console.log('  ✗ FAIL: Expected 401, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Test 12: Test malformed token
  console.log('\n[Test 12] Test malformed token');
  try {
    const res = await request('GET', '/api/auth/me', null, 'not-a-valid-token');
    if (res.status === 401 && res.data.code === 40102) {
      console.log('  ✓ PASS: Malformed token rejected');
      passed++;
    } else {
      console.log('  ✗ FAIL: Expected 401, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  ✗ FAIL:', e.message);
    failed++;
  }

  // Cleanup
  console.log('\n[Cleanup] Removing test data');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.players.delete({ where: { id: testParticipantId } });
    await prisma.competitions.delete({ where: { id: testCompetitionId } });
    await prisma.users.delete({ where: { id: testUserId } });
    await prisma.organizations.delete({ where: { id: testOrgId } });
    console.log('  ✓ Cleanup complete');
    await prisma.$disconnect();
  } catch (e) {
    console.log('  ⚠ Cleanup warning:', e.message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total:  ${passed + failed}`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Failed: ${failed} ${failed > 0 ? '✗' : ''}`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
