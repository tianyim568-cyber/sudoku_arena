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
  console.log('=== Stage 1 Round 2 & Round 3 Verification ===');
  let pass = 0, fail = 0;

  function check(name, res) {
    const ok = res && res.code === 200;
    if (ok) { pass++; console.log('  PASS:', name); }
    else { fail++; console.log('  FAIL:', name, '-', JSON.stringify(res).substring(0, 400)); }
    return ok;
  }

  // Logins
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

  // --- Setup ---
  const t = await adminApi('POST', '/api/tournaments', { name: 'R2R3 Test' });
  const tid = t.data.id;

  const r1 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
  const r2 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R2', roundType: 'ROUND2_RELAY', durationSeconds: 900 });
  const r3 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R3', roundType: 'ROUND3_COLLABORATE', durationSeconds: 1200 });
  const r2Id = r2.data.id;
  const r3Id = r3.data.id;

  const team1 = await adminApi('POST', '/api/tournaments/' + tid + '/teams', { name: 'Red' });
  const team2 = await adminApi('POST', '/api/tournaments/' + tid + '/teams', { name: 'Blue' });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p1Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p2Id, position: 2 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p3Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p4Id, position: 2 });
  await adminApi('POST', '/api/tournaments/' + tid + '/judges', { judgeId: judgeId });

  // Import R1 puzzles (minimal)
  const puzzles1 = [];
  for (let i = 1; i <= 9; i++) {
    const sol = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + i) % 9 + 1));
    puzzles1.push({ type: 'JOC', order: i, initialGrid: sol.map(r => r.map((v, c) => c < 3 ? v : 0)), solution: sol, points: 100, letter: String.fromCharCode(64 + i) });
  }
  puzzles1.push({ type: 'FINAL', order: 10, initialGrid: Array(9).fill(null).map(() => Array(9).fill(0)), solution: Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + 1) % 9 + 1)), points: 200 });
  await adminApi('POST', '/api/rounds/' + r1.data.id + '/puzzles/import', { puzzles: puzzles1 });

  // Import R2 puzzles (4 per team, 2 teams = 8 puzzles + 8 more)
  const puzzles2 = [];
  for (let i = 1; i <= 16; i++) {
    const sol = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + i) % 9 + 1));
    const grid = sol.map(row => row.map((v, c) => c < 3 ? v : 0));
    const teamId = i <= 8 ? team1.data.id : team2.data.id;
    const diff = i % 3 === 0 ? 'HARD' : (i % 3 === 1 ? 'EASY' : 'MEDIUM');
    puzzles2.push({ type: 'RELAY', order: i, initialGrid: grid, solution: sol, points: 100, letter: null, teamId, difficulty: diff });
  }
  check('Import R2 puzzles', await adminApi('POST', '/api/rounds/' + r2Id + '/puzzles/import', { puzzles: puzzles2 }));

  // Import R3 puzzles (1 large collaborative grid)
  const puzzles3 = [];
  const sol3 = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + 1) % 9 + 1));
  puzzles3.push({ type: 'COLLABORATE', order: 1, initialGrid: sol3.map(r => r.map((v, c) => c < 3 ? v : 0)), solution: sol3, points: 300 });
  check('Import R3 puzzles', await adminApi('POST', '/api/rounds/' + r3Id + '/puzzles/import', { puzzles: puzzles3 }));

  // --- Start Game + R1 (must complete R1 first) ---
  check('Start tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/start'));
  check('Start round 1', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r1.data.id + '/start'));

  // End R1 quickly
  check('End round 1', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r1.data.id + '/end'));

  // --- Round 2 ---
  check('Start round 2', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r2Id + '/start'));

  const r2State = await p1Api('GET', '/api/tournaments/' + tid + '/my-state');
  check('Get R2 game state', r2State);

  if (r2State.code === 200) {
    console.log('    R2 current round:', r2State.data.currentRound?.roundType);
    console.log('    R2 state:', r2State.data.round2State ? 'present' : 'null');
    if (r2State.data.round2State) {
      const r2s = r2State.data.round2State;
      console.log('    Assigned puzzle:', r2s.assignedPuzzleId, 'Total puzzles:', r2s.totalPuzzles);
    }
  }

  check('End round 2', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r2Id + '/end'));

  // --- Round 3 ---
  check('Start round 3', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r3Id + '/start'));

  const r3State = await p1Api('GET', '/api/tournaments/' + tid + '/my-state');
  check('Get R3 game state', r3State);

  if (r3State.code === 200) {
    console.log('    R3 current round:', r3State.data.currentRound?.roundType);
    console.log('    R3 puzzles:', r3State.data.puzzles?.length);
  }

  check('End round 3', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r3Id + '/end'));

  // --- Final ---
  check('End tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/end'));
  check('Get final scores', await p1Api('GET', '/api/tournaments/' + tid + '/scores/my'));

  // Cleanup
  await adminApi('DELETE', '/api/tournaments/' + tid);

  console.log('');
  console.log('=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

test().catch(e => { console.error('Error:', e.message); process.exit(1); });
