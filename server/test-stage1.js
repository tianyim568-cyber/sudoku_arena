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
  console.log('=== Stage 1 Final Verification ===');
  let pass = 0, fail = 0;

  function check(name, res) {
    const ok = res && res.code === 200;
    if (ok) { pass++; console.log('  PASS:', name); }
    else { fail++; console.log('  FAIL:', name, '-', JSON.stringify(res).substring(0, 300)); }
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
  const t = await adminApi('POST', '/api/tournaments', { name: 'Final Verification' });
  const tid = t.data.id;

  const r1 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
  const r2 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R2', roundType: 'ROUND2_RELAY', durationSeconds: 900 });
  const r3 = await adminApi('POST', '/api/tournaments/' + tid + '/rounds', { name: 'R3', roundType: 'ROUND3_COLLABORATE', durationSeconds: 1200 });
  const r1Id = r1.data.id;

  const team1 = await adminApi('POST', '/api/tournaments/' + tid + '/teams', { name: 'Red' });
  const team2 = await adminApi('POST', '/api/tournaments/' + tid + '/teams', { name: 'Blue' });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p1Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team1.data.id + '/members', { playerId: p2Id, position: 2 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p3Id, position: 1 });
  await adminApi('POST', '/api/teams/' + team2.data.id + '/members', { playerId: p4Id, position: 2 });
  await adminApi('POST', '/api/tournaments/' + tid + '/judges', { judgeId: judgeId });

  // Import R1 puzzles: 9 JOC + 1 FINAL
  const puzzles = [];
  for (let i = 1; i <= 9; i++) {
    const sol = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + i) % 9 + 1));
    const grid = sol.map(row => row.map((v, c) => c < 3 ? v : 0));
    puzzles.push({ type: 'JOC', order: i, initialGrid: grid, solution: sol, points: 100, letter: String.fromCharCode(64 + i) });
  }
  const finalSol = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + 1) % 9 + 1));
  puzzles.push({ type: 'FINAL', order: 10, initialGrid: Array(9).fill(null).map(() => Array(9).fill(0)), solution: finalSol, points: 200 });

  check('Import R1 puzzles', await adminApi('POST', '/api/rounds/' + r1Id + '/puzzles/import', { puzzles }));

  // --- Start Game ---
  check('Start tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/start'));
  check('Start round 1', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r1Id + '/start'));

  // --- Player State ---
  const myState = await p1Api('GET', '/api/tournaments/' + tid + '/my-state');
  check('Get my game state', myState);

  if (myState.code === 200 && myState.data.puzzles?.length > 0) {
    const firstPuzzle = myState.data.puzzles[0];
    console.log('    Puzzles: ' + myState.data.puzzles.length + ', R1 progress: ' + (myState.data.round1Progress ? 'yes' : 'no'));

    // Submit SINGLE_CELL with correct answer
    const submitCell = await p1Api('POST', '/api/submissions', {
      roundId: r1Id, puzzleId: firstPuzzle.puzzleId,
      submissionType: 'SINGLE_CELL', row: 0, col: 3, value: 5
    });
    check('Submit SINGLE_CELL (correct)', submitCell);

    // Submit FULL_GRID for puzzle 2
    if (myState.data.puzzles.length > 1) {
      const secondPuzzle = myState.data.puzzles[1];
      const grid2 = Array(9).fill(null).map((_, r) => Array(9).fill(null).map((_, c) => (r * 9 + c + 2) % 9 + 1));
      const submitGrid = await p1Api('POST', '/api/submissions', {
        roundId: r1Id, puzzleId: secondPuzzle.puzzleId,
        submissionType: 'FULL_GRID', grid: grid2
      });
      check('Submit FULL_GRID (correct)', submitGrid);
    }
  }

  // --- Room Status ---
  check('Get room status', await judgeApi('GET', '/api/tournaments/' + tid + '/room/status'));

  // --- Pause/Resume ---
  check('Pause tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/pause'));
  check('Resume tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/resume'));

  // --- End Round + Scores ---
  check('End round 1', await judgeApi('POST', '/api/tournaments/' + tid + '/rounds/' + r1Id + '/end'));
  check('Get my scores', await p1Api('GET', '/api/tournaments/' + tid + '/scores/my'));
  check('Get team scores', await p1Api('GET', '/api/tournaments/' + tid + '/scores/teams'));
  check('End tournament', await judgeApi('POST', '/api/tournaments/' + tid + '/end'));

  // Cleanup
  await adminApi('DELETE', '/api/tournaments/' + tid);

  console.log('');
  console.log('=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

test().catch(e => { console.error('Error:', e.message); process.exit(1); });
