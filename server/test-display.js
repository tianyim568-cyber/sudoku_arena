/**
 * Display System Tests
 *
 * Tests the big-screen display token management and ranking snapshot endpoints.
 * Covers: generate token, verify token, revoke token, get ranking snapshot.
 */

const http = require('http');
const assert = require('assert');

const API_BASE = 'http://localhost:3001/api';

// Helper to make HTTP requests
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
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
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=== Display System Tests ===\n');

  let adminToken = null;
  let competitionId = null;
  let displayToken = null;

  try {
    // Test 1: Login as admin
    console.log('Test 1: Login as admin');
    const loginRes = await request('POST', '/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    assert.strictEqual(loginRes.body.code, 200, 'Login should succeed');
    adminToken = loginRes.body.data.token;
    console.log('✓ Admin logged in\n');

    // Test 2: Use known competition ID
    console.log('Test 2: Set competition ID');
    competitionId = '11111111-1111-1111-1111-111111111111';
    console.log(`✓ Using competition: ${competitionId}\n`);

    // Test 3: Generate display token
    console.log('Test 3: Generate display token');
    const genRes = await request('POST', `/competitions/${competitionId}/display-token`, null, adminToken);
    assert.strictEqual(genRes.body.code, 200, 'Should generate token');
    assert(genRes.body.data.token, 'Should return token');
    assert(genRes.body.data.displayUrl, 'Should return display URL');
    displayToken = genRes.body.data.token;
    console.log(`✓ Display token generated: ${displayToken.slice(0, 16)}...`);
    console.log(`✓ Display URL: ${genRes.body.data.displayUrl}\n`);

    // Test 4: Verify token via public endpoint
    console.log('Test 4: Get ranking with valid token');
    const rankRes = await request('GET', `/display/${displayToken}/ranking`);
    assert.strictEqual(rankRes.body.code, 200, 'Should return ranking data');
    assert(rankRes.body.data.competition, 'Should include competition info');
    assert(Array.isArray(rankRes.body.data.stages), 'Should include stages array');
    assert(Array.isArray(rankRes.body.data.categories), 'Should include categories array');
    console.log('✓ Ranking data retrieved successfully');
    console.log(`  Competition: ${rankRes.body.data.competition.name}`);
    console.log(`  Stages: ${rankRes.body.data.stages.length}`);
    console.log(`  Categories: ${rankRes.body.data.categories.length}\n`);

    // Test 5: Get ranking with category filter
    console.log('Test 5: Get ranking with category filter');
    if (rankRes.body.data.categories.length > 0) {
      const categoryId = rankRes.body.data.categories[0].id;
      const filteredRes = await request('GET', `/display/${displayToken}/ranking?categoryId=${categoryId}`);
      assert.strictEqual(filteredRes.body.code, 200, 'Should return filtered ranking');
      console.log(`✓ Filtered ranking retrieved for category: ${rankRes.body.data.categories[0].name}\n`);
    } else {
      console.log('⊘ Skipped (no categories available)\n');
    }

    // Test 6: Reject invalid token
    console.log('Test 6: Reject invalid token');
    const invalidRes = await request('GET', '/display/invalid-token-12345/ranking');
    assert.strictEqual(invalidRes.status, 401, 'Should return 401 for invalid token');
    assert.strictEqual(invalidRes.body.code, 40102, 'Should return correct error code');
    console.log('✓ Invalid token rejected\n');

    // Test 7: Revoke display token
    console.log('Test 7: Revoke display token');
    const revokeRes = await request('DELETE', `/competitions/${competitionId}/display-token`, null, adminToken);
    assert.strictEqual(revokeRes.body.code, 200, 'Should revoke token');
    console.log('✓ Display token revoked\n');

    // Test 8: Verify revoked token no longer works
    console.log('Test 8: Verify revoked token fails');
    const revokedRes = await request('GET', `/display/${displayToken}/ranking`);
    assert.strictEqual(revokedRes.status, 401, 'Should reject revoked token');
    console.log('✓ Revoked token rejected\n');

    // Test 9: Generate new token (replace revoked one)
    console.log('Test 9: Generate new token after revocation');
    const regenRes = await request('POST', `/competitions/${competitionId}/display-token`, null, adminToken);
    assert.strictEqual(regenRes.body.code, 200, 'Should generate new token');
    assert.notStrictEqual(regenRes.body.data.token, displayToken, 'New token should differ');
    console.log(`✓ New token generated: ${regenRes.body.data.token.slice(0, 16)}...\n`);

    console.log('=== All Display Tests Passed ===\n');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
