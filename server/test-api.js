const http = require('http');

const BASE_URL = 'http://localhost:3001';
let authToken = '';
let testOrgId = '';
let testUserId = '';
let testUsername = '';
let testCompetitionId = '';
let testAccessCode = '';

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
  console.log('API INTEGRATION TESTS');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;
  const uniqueId = Date.now();

  // Test 1: Register new organization
  console.log('\n[Test 1] POST /api/auth/register');
  try {
    const res = await request('POST', '/api/auth/register', {
      organizationName: `Test Org ${uniqueId}`,
      adminUsername: `admin_${uniqueId}`,
      password: 'testpass123'
    });
    if (res.status === 201 && res.data.code === 200) {
      console.log('  PASS: Registration successful');
      console.log(`    Organization: ${res.data.data.organization.name} (${res.data.data.organization.id})`);
      console.log(`    User: ${res.data.data.user.username} (${res.data.data.user.id})`);
      authToken = res.data.data.token;
      testOrgId = res.data.data.organization.id;
      testUserId = res.data.data.user.id;
      testUsername = res.data.data.user.username;
      passed++;
    } else {
      console.log('  FAIL:', res.data.message || res.data);
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 2: Login with created user
  console.log('\n[Test 2] POST /api/auth/login');
  try {
    const res = await request('POST', '/api/auth/login', {
      username: testUsername,
      password: 'testpass123'
    });
    if (res.status === 200 && res.data.code === 200) {
      console.log('  PASS: Login successful');
      console.log(`    User: ${res.data.data.user.username}, Role: ${res.data.data.user.role}`);
      authToken = res.data.data.token;
      passed++;
    } else {
      console.log('  FAIL:', res.data.message || res.data);
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 3: Get current user info
  console.log('\n[Test 3] GET /api/auth/me');
  try {
    const res = await request('GET', '/api/auth/me', null, authToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  PASS: User info retrieved');
      console.log(`    Username: ${res.data.data.username}, Role: ${res.data.data.role}`);
      console.log(`    Org ID: ${res.data.data.organizationId}`);
      passed++;
    } else {
      console.log('  FAIL:', res.data.message || res.data);
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 4: Unauthenticated access
  console.log('\n[Test 4] GET /api/auth/me (no token)');
  try {
    const res = await request('GET', '/api/auth/me');
    if (res.status === 401 && res.data.code === 40101) {
      console.log('  PASS: Unauthenticated request rejected');
      passed++;
    } else {
      console.log('  FAIL: Expected 401, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 5: Wrong password
  console.log('\n[Test 5] POST /api/auth/login (wrong password)');
  try {
    const res = await request('POST', '/api/auth/login', {
      username: testUsername,
      password: 'wrongpassword'
    });
    if (res.data.code === 40001) {
      console.log('  PASS: Wrong password rejected');
      console.log(`    Message: ${res.data.message}`);
      passed++;
    } else {
      console.log('  FAIL: Expected code 40001, got', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 6: Duplicate username registration
  console.log('\n[Test 6] POST /api/auth/register (duplicate username)');
  try {
    const res = await request('POST', '/api/auth/register', {
      organizationName: `Other Org ${Date.now()}`,
      adminUsername: testUsername,
      password: 'testpass123'
    });
    if (res.data.code === 40003 && res.data.message.includes('用户名已存在')) {
      console.log('  PASS: Duplicate username rejected');
      console.log(`    Message: ${res.data.message}`);
      passed++;
    } else {
      console.log('  FAIL: Expected code 40003 (username exists), got', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 7: Duplicate org name registration
  console.log('\n[Test 7] POST /api/auth/register (duplicate org name)');
  try {
    const res = await request('POST', '/api/auth/register', {
      organizationName: `Test Org ${uniqueId}`,
      adminUsername: `other_admin_${Date.now()}`,
      password: 'testpass123'
    });
    if (res.data.code === 40003 && res.data.message.includes('组织名称已存在')) {
      console.log('  PASS: Duplicate org name rejected');
      console.log(`    Message: ${res.data.message}`);
      passed++;
    } else {
      console.log('  FAIL: Expected code 40003 (org exists), got', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 8: Create a test competition directly in DB
  console.log('\n[Test 8] Create test competition');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const comp = await prisma.competitions.create({
      data: {
        name: 'Test Competition',
        organization_id: testOrgId,
        status: 'DRAFT',
      }
    });
    testCompetitionId = comp.id;
    console.log('  PASS: Competition created');
    console.log(`    ID: ${testCompetitionId}`);
    await prisma.$disconnect();
    passed++;
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 9: Generate access link
  console.log('\n[Test 9] POST /api/competitions/:id/access-link (generate)');
  try {
    const res = await request('POST', `/api/competitions/${testCompetitionId}/access-link`, null, authToken);
    if (res.status === 200 && res.data.code === 200 && res.data.data.accessCode) {
      console.log('  PASS: Access link generated');
      console.log(`    Access Code: ${res.data.data.accessCode}`);
      console.log(`    Entry URL: ${res.data.data.entryUrl}`);
      testAccessCode = res.data.data.accessCode;
      // Validate format: 8 chars alphanumeric
      if (testAccessCode.length === 8 && /^[a-z0-9]+$/.test(testAccessCode)) {
        console.log('    Format valid: 8-char lowercase alphanumeric');
        passed++;
      } else {
        console.log('    FAIL: Access code format invalid:', testAccessCode);
        failed++;
      }
    } else {
      console.log('  FAIL:', res.data.message || JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 10: Retrieve access link
  console.log('\n[Test 10] GET /api/competitions/:id/access-link');
  try {
    const res = await request('GET', `/api/competitions/${testCompetitionId}/access-link`, null, authToken);
    if (res.status === 200 && res.data.code === 200 && res.data.data.accessCode === testAccessCode) {
      console.log('  PASS: Access link retrieved, code matches');
      passed++;
    } else {
      console.log('  FAIL:', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 11: Public info by access code
  console.log('\n[Test 11] GET /api/competitions/by-code/:code/info (public)');
  try {
    const res = await request('GET', `/api/competitions/by-code/${testAccessCode}/info`);
    if (res.status === 200 && res.data.code === 200 && res.data.data.id === testCompetitionId) {
      console.log('  PASS: Public info retrieved by access code');
      console.log(`    Name: ${res.data.data.name}, Status: ${res.data.data.status}`);
      console.log(`    Organization: ${res.data.data.organizationName}`);
      passed++;
    } else {
      console.log('  FAIL:', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 12: Revoke access link
  console.log('\n[Test 12] DELETE /api/competitions/:id/access-link (revoke)');
  try {
    const res = await request('DELETE', `/api/competitions/${testCompetitionId}/access-link`, null, authToken);
    if (res.status === 200 && res.data.code === 200) {
      console.log('  PASS: Access link revoked');
      // Verify it's null now
      const verify = await request('GET', `/api/competitions/${testCompetitionId}/access-link`, null, authToken);
      if (verify.data.data.accessCode === null) {
        console.log('    Verified: accessCode is null after revoke');
        passed++;
      } else {
        console.log('    FAIL: accessCode not null after revoke:', verify.data.data.accessCode);
        failed++;
      }
    } else {
      console.log('  FAIL:', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 13: Public info by revoked code (should 404)
  console.log('\n[Test 13] GET /api/competitions/by-code/:code/info (after revoke)');
  try {
    const res = await request('GET', `/api/competitions/by-code/${testAccessCode}/info`);
    if (res.data.code === 40400) {
      console.log('  PASS: Revoked code returns 404');
      passed++;
    } else {
      console.log('  FAIL: Expected 40400, got', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 14: Access link without auth
  console.log('\n[Test 14] POST /api/competitions/:id/access-link (no token)');
  try {
    const res = await request('POST', `/api/competitions/${testCompetitionId}/access-link`);
    if (res.status === 401 && res.data.code === 40101) {
      console.log('  PASS: Unauthenticated access link generation rejected');
      passed++;
    } else {
      console.log('  FAIL: Expected 401, got', res.status, JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Test 15: Health check
  console.log('\n[Test 15] GET /api/health');
  try {
    const res = await request('GET', '/api/health');
    if (res.status === 200 && res.data.status === 'ok') {
      console.log('  PASS: Health check OK');
      passed++;
    } else {
      console.log('  FAIL:', JSON.stringify(res.data));
      failed++;
    }
  } catch (e) {
    console.log('  FAIL:', e.message);
    failed++;
  }

  // Cleanup
  console.log('\n[Cleanup] Removing test data');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.competitions.delete({ where: { id: testCompetitionId } });
    await prisma.users.delete({ where: { id: testUserId } });
    await prisma.organizations.delete({ where: { id: testOrgId } });
    console.log('  Cleanup complete');
    await prisma.$disconnect();
  } catch (e) {
    console.log('  Cleanup warning:', e.message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total:  ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
