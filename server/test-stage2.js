const http = require('http');

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3001, path, method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('=== Stage 2 Timer + Pause/Resume Verification ===');
  let pass = 0, fail = 0;

  function check(name, res) {
    const ok = res && res.code === 200;
    if (ok) { pass++; console.log('  PASS:', name); }
    else { fail++; console.log('  FAIL:', name, '-', JSON.stringify(res).substring(0, 400)); }
    return ok;
  }

  const adminLogin = await apiCall('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = adminLogin.data.token;
  const judgeLogin = await apiCall('POST', '/api/auth/login', { username: 'judge', password: 'judge123' });
  const judgeToken = judgeLogin.data.token;
  const judgeId = judgeLogin.data.user.id;
  const p1Login = await apiCall('POST', '/api/auth/login', { username: 'player1', password: 'player123' });
  const p1Token = p1Login.data.token;
  const p1Id = p1Login.data.user.id;
  const p2Login = await apiCall('POST', '/api/auth/login', { username: 'player2', password: 'player123' });
  const p2Id = p2Login.data.user.id;
  const p3Login = await apiCall('POST', '/api/auth/login', { username: 'player3', password: 'player123' });
  const p3Id = p3Login.data.user.id;
  const p4Login = await apiCall('POST', '/api/auth/login', { username: 'player4', password: 'player123' });
  const p4Id = p4Login.data.user.id;

  function adminApi(m, p, b) { return apiCall(m, p, b, adminToken); }
  function judgeApi(m, p, b) { return apiCall(m, p, b, judgeToken); }
  function p1Api(m, p, b) { return apiCall(m, p, b, p1Token); }

  // Setup competition with 3 rounds
  const t = await adminApi('POST', '/api/competitions', { name: 'Timer Test' });
  const tid = t.data.id;
  const r1 = await adminApi('POST', '/api/competitions/' + tid + '/rounds', { name: 'R1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
  const r2 = await adminApi('POST', '/api/competitions/' + tid + '/rounds', { name: 'R2', roundType: 'ROUND2_RELAY', durationSeconds: 900 });
  const r3 = await adminApi('POST', '/api/competitions/' + tid + '/rounds', { name: 'R3', roundType: 'ROUND3_COLLABORATE', durationSeconds: 1200 });

  const team1 = await adminApi('POST', '/api/competitions/' + tid + '/teams', { name: 'Red' });
  const team2 = await adminApi('POST', '/api/competitions/' + tid + '/teams', { name: 'Blue' });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p1Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p2Id, position: 2 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p3Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p4Id, position: 2 });
  await adminApi('POST', '/api/competitions/' + tid + '/judges', { judgeId: judgeId });

  // Import R1 puzzles
  const puzzles1 = [];
  for (let i = 1; i <= 9; i++) {
    const sol = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + i) % 9 + 1));
    puzzles1.push({ type: 'JOC', order: i, initialGrid: sol.map(r => r.map((v, c) => c < 3 ? v : 0)), solution: sol, points: 100, letter: String.fromCharCode(64 + i) });
  }
  puzzles1.push({ type: 'FINAL', order: 10, initialGrid: Array(9).fill(null).map(() => Array(9).fill(0)), solution: Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + 1) % 9 + 1)), points: 200 });
  await adminApi('POST', '/api/rounds/' + r1.data.id + '/puzzles/import', { puzzles: puzzles1 });

  // Start competition
  check('Start competition', await judgeApi('POST', '/api/competitions/' + tid + '/start'));

  // Start R1
  const startRes = await judgeApi('POST', '/api/competitions/' + tid + '/rounds/' + r1.data.id + '/start');
  check('Start R1', startRes);

  // Verify turnEndsAt is returned
  if (startRes.code === 200 && startRes.data.turnEndsAt) {
    const turnEndsAt = startRes.data.turnEndsAt;
    const now = Date.now();
    const diff = turnEndsAt - now;
    console.log('    turnEndsAt diff from now:', diff, 'ms (should be ~600000)');
    check('turnEndsAt is ~600s from now', { code: diff > 595000 && diff < 605000 ? 200 : 40040 });
  } else {
    fail++; console.log('  FAIL: turnEndsAt not returned in startRound response');
  }

  // Get state and verify remainingSeconds
  const state1 = await p1Api('GET', '/api/competitions/' + tid + '/my-state');
  check('Get R1 state after start', state1);
  if (state1.code === 200) {
    const remaining = state1.data.currentRound.remainingSeconds;
    console.log('    Remaining seconds:', remaining, '(should be ~600)');
    check('Remaining ~600', { code: remaining > 595 && remaining <= 600 ? 200 : 40040 });
  }

  // Wait 2 seconds and check state again (timer should tick)
  await new Promise(r => setTimeout(r, 2000));
  const state2 = await p1Api('GET', '/api/competitions/' + tid + '/my-state');
  if (state2.code === 200) {
    const remaining2 = state2.data.currentRound.remainingSeconds;
    console.log('    After 2s, remaining:', remaining2, '(should be ~598)');
    check('Timer ticking', { code: remaining2 <= 598 ? 200 : 40040 });
  }

  // Pause
  check('Pause competition', await judgeApi('POST', '/api/competitions/' + tid + '/pause'));

  // Check state while paused
  const statePaused = await p1Api('GET', '/api/competitions/' + tid + '/my-state');
  if (statePaused.code === 200) {
    const remainingPaused = statePaused.data.currentRound.remainingSeconds;
    console.log('    Remaining while paused:', remainingPaused);
    check('Remaining preserved on pause', { code: remainingPaused > 0 ? 200 : 40040 });
  }

  // Wait 3 seconds while paused (remaining should NOT decrease)
  await new Promise(r => setTimeout(r, 3000));
  const statePaused2 = await p1Api('GET', '/api/competitions/' + tid + '/my-state');
  if (statePaused2.code === 200) {
    const remainingPaused2 = statePaused2.data.currentRound.remainingSeconds;
    const diff = statePaused.data.currentRound.remainingSeconds - remainingPaused2;
    console.log('    Remaining after 3s paused:', remainingPaused2, 'diff:', diff, '(should be ~0)');
    check('Timer stopped on pause', { code: diff <= 1 ? 200 : 40040 });
  }

  // Resume
  check('Resume competition', await judgeApi('POST', '/api/competitions/' + tid + '/resume'));

  // Wait 2 seconds after resume (timer should tick again)
  await new Promise(r => setTimeout(r, 2000));
  const stateResumed = await p1Api('GET', '/api/competitions/' + tid + '/my-state');
  if (stateResumed.code === 200) {
    const remainingResumed = stateResumed.data.currentRound.remainingSeconds;
    const beforeResume = statePaused2.data.currentRound.remainingSeconds;
    console.log('    Remaining after resume+2s:', remainingResumed, '(was', beforeResume, ')');
    check('Timer resumes after resume', { code: remainingResumed < beforeResume ? 200 : 40040 });
  }

  // Cleanup
  check('End round 1', await judgeApi('POST', '/api/competitions/' + tid + '/rounds/' + r1.data.id + '/end'));
  check('End competition', await judgeApi('POST', '/api/competitions/' + tid + '/end'));
  await adminApi('DELETE', '/api/competitions/' + tid);

  console.log('');
  console.log('=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

test().catch(e => { console.error('Error:', e.message); process.exit(1); });
