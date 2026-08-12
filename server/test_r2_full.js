// Full end-to-end test for Round 2 (Relay) — multi-player, submission, scoring.
// Rebuilt to match the current PostgreSQL + GameOrchestrator architecture:
//   - Talks to an already-running server on port 3001 (like test-round1-e2e.js)
//   - Uses Node's built-in http module instead of axios (not installed)
//   - Uses ROUND3_COLLABORATE (ROUND3_SPEED was the old invalid enum)
//   - Reads puzzle solutions via the admin puzzle-bank preview endpoint
//     instead of a raw DB query (which used to be sync in SQLite)
//   - Drops the CELL_UPDATE submission type (invalid in submitAnswerSchema —
//     only SINGLE_CELL and FULL_GRID are accepted; cell updates go via socket)

require('dotenv').config({ path: __dirname + '/.env' });

const http = require('http');

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log('  PASS: ' + name); }
  else { failed++; console.log('  FAIL: ' + name); }
}

async function main() {
  console.log('=== Round 2 Full End-to-End Verification ===\n');

  // 1. Logins.
  let r = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const a = r.data?.token;
  console.log('1. Admin login:', a ? 'OK' : 'FAILED');

  r = await request('POST', '/api/auth/login', { username: 'judge', password: 'judge123' });
  const j = r.data?.token;
  console.log('2. Judge login:', j ? 'OK' : 'FAILED');

  const pTokens = {};
  for (const name of ['player1', 'player2', 'player3']) {
    r = await request('POST', '/api/auth/login', { username: name, password: 'player123' });
    pTokens[name] = r.data?.token;
  }
  console.log('3. Players logged in:', Object.values(pTokens).filter(Boolean).length + '/3');

  // 4. Setup tournament, teams, rounds, puzzles.
  r = await request('GET', '/api/users', null, a);
  const playerIds = r.data?.filter(u => u.role === 'PLAYER').map(u => u.id) || [];

  r = await request('POST', '/api/tournaments', { name: 'R2 Full Verify', description: 'E2E' }, a);
  const tid = r.data?.id;
  console.log('4. Create tournament:', r.code === 200 ? `OK (id=${tid})` : `FAILED: ${r.message}`);

  r = await request('POST', `/api/tournaments/${tid}/teams`, { name: 'TeamA' }, a);
  const teamId = r.data?.id;
  for (let i = 0; i < 3; i++) {
    await request('POST', `/api/teams/${teamId}/members`, { playerId: playerIds[i], position: i + 1 }, a);
  }
  console.log('5. Team created with 3 members');

  // Use ROUND3_COLLABORATE (not ROUND3_SPEED).
  const roundTypes = ['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE'];
  const roundIds = {};
  for (let i = 0; i < 3; i++) {
    r = await request('POST', `/api/tournaments/${tid}/rounds`, {
      name: `Round ${i + 1}`,
      roundType: roundTypes[i],
      durationSeconds: 600,
      roundNumber: i + 1
    }, a);
    roundIds[roundTypes[i]] = r.data?.id;
  }
  console.log('6. Rounds created:', JSON.stringify(roundIds));

  await request('POST', '/api/puzzle-bank/generate', { roundType: 'ROUND1_NINE_ONE', count: 10 }, a);
  await request('POST', '/api/puzzle-bank/generate', { roundType: 'ROUND2_RELAY', count: 32, teamsCount: 2 }, a);
  await request('POST', '/api/puzzle-bank/import-to-round', { roundId: roundIds.ROUND1_NINE_ONE, count: 10 }, a);
  await request('POST', '/api/puzzle-bank/import-to-round', { roundId: roundIds.ROUND2_RELAY, count: 32 }, a);
  console.log('7. Puzzles generated and imported');

  // 8. Start tournament, R1, end R1, start R2.
  await request('POST', `/api/tournaments/${tid}/start`, null, j);
  await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND1_NINE_ONE}/start`, null, j);
  await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND1_NINE_ONE}/end`, null, j);
  r = await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND2_RELAY}/start`, null, j);
  console.log('8. Start R2:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  // TEST 1: Simultaneous play — each player gets a different puzzle.
  console.log('\n=== TEST 1: Simultaneous Play — Each player gets a different puzzle ===');
  const s1 = (await request('GET', `/api/tournaments/${tid}/my-state`, null, pTokens.player1)).data;
  const s2 = (await request('GET', `/api/tournaments/${tid}/my-state`, null, pTokens.player2)).data;
  const s3 = (await request('GET', `/api/tournaments/${tid}/my-state`, null, pTokens.player3)).data;

  const p1Pid = s1?.round2State?.assignedPuzzleId;
  const p2Pid = s2?.round2State?.assignedPuzzleId;
  const p3Pid = s3?.round2State?.assignedPuzzleId;

  check('Player 1 has assigned puzzle', !!p1Pid);
  check('Player 2 has assigned puzzle', !!p2Pid);
  check('Player 3 has assigned puzzle', !!p3Pid);
  check('All 3 players have different puzzles',
    p1Pid && p2Pid && p3Pid && p1Pid !== p2Pid && p2Pid !== p3Pid && p1Pid !== p3Pid);
  check('Player 1 puzzle has currentGrid', !!s1?.round2State?.assignedPuzzle?.currentGrid);
  check('Player 2 puzzle has currentGrid', !!s2?.round2State?.assignedPuzzle?.currentGrid);
  check('Player 3 puzzle has currentGrid', !!s3?.round2State?.assignedPuzzle?.currentGrid);

  // TEST 2: Puzzle board — 16 puzzles with correct difficulty.
  console.log('\n=== TEST 2: Puzzle Board — 16 puzzles with correct difficulty ===');
  check('Puzzle board has 16 puzzles', s1?.round2State?.puzzles?.length === 16);
  const easy = s1?.round2State?.puzzles?.filter(p => p.difficulty === 'EASY').length;
  const med = s1?.round2State?.puzzles?.filter(p => p.difficulty === 'MEDIUM').length;
  const hard = s1?.round2State?.puzzles?.filter(p => p.difficulty === 'HARD').length;
  check('8 Easy puzzles', easy === 8);
  check('6 Medium puzzles', med === 6);
  check('2 Hard puzzles', hard === 2);
  check('Solved count is 0', s1?.round2State?.solvedCount === 0);
  check('Team score is 0', s1?.round2State?.teamScore === 0);

  // TEST 3: Player order.
  console.log('\n=== TEST 3: Player Order ===');
  check('Player order has 3 members', s1?.round2State?.playerOrder?.length === 3);

  // TEST 4: Wrong submission rejected.
  console.log('\n=== TEST 4: Wrong submission rejected ===');
  const wrongRes = await request('POST', '/api/submissions', {
    roundId: roundIds.ROUND2_RELAY,
    puzzleId: p1Pid,
    submissionType: 'FULL_GRID',
    grid: Array(9).fill(null).map(() => Array(9).fill(1))
  }, pTokens.player1);
  check('Wrong sub returns 200 (REST wraps engine result)', wrongRes.code === 200);
  check('Wrong sub isCorrect is false', wrongRes.data?.isCorrect === false);

  // TEST 5: Correct submission accepted with difficulty-based points.
  // We read the puzzle solution directly from PostgreSQL. The old script
  // tried dbHelpers.get() synchronously (broken in async PG); an earlier
  // fix tried /api/puzzle-bank/:id/preview, but that endpoint reads from
  // the puzzle bank JSON file, NOT from the puzzles table — and after
  // import-to-round the puzzle has a new PG-generated id that doesn't
  // exist in the bank. Going direct to the DB is the only reliable source.
  console.log('\n=== TEST 5: Correct submission accepted with difficulty-based points ===');
  const { createPostgresConnection, closeConnection } = require('./src/db/connection');
  const conn = await createPostgresConnection();
  const ap1 = s1?.round2State?.assignedPuzzle;
  const difficulty = ap1?.difficulty;
  const expectedPoints = { EASY: 8, MEDIUM: 16, HARD: 20 }[difficulty] || 16;

  const puzzleRow = await conn.get('SELECT solution FROM puzzles WHERE id = $1', [p1Pid]);
  const solution = puzzleRow ? JSON.parse(puzzleRow.solution) : null;
  await closeConnection();

  if (!solution) {
    console.log(`  (could not load solution for puzzle id=${p1Pid}; skipping correct-submission test)`);
  } else {
    const correctRes = await request('POST', '/api/submissions', {
      roundId: roundIds.ROUND2_RELAY,
      puzzleId: p1Pid,
      submissionType: 'FULL_GRID',
      grid: solution
    }, pTokens.player1);
    check('Correct sub returns 200', correctRes.code === 200);
    check('Correct sub isCorrect is true', correctRes.data?.isCorrect === true);
    check(`Points awarded = ${expectedPoints} (difficulty: ${difficulty})`,
      correctRes.data?.pointsEarned === expectedPoints);
  }

  // TEST 6: New puzzle assigned after solving.
  console.log('\n=== TEST 6: New puzzle assigned after solving ===');
  const s1after = (await request('GET', `/api/tournaments/${tid}/my-state`, null, pTokens.player1)).data;
  const newPid = s1after?.round2State?.assignedPuzzleId;
  check('New puzzle assigned (different from solved)', newPid && newPid !== p1Pid);
  check('Solved count is 1', s1after?.round2State?.solvedCount === 1);
  check(`Team score = ${expectedPoints}`, s1after?.round2State?.teamScore === expectedPoints);

  // TEST 7: Cell update — SKIPPED.
  // The old script tried submissionType: 'CELL_UPDATE' via REST, but
  // submitAnswerSchema only accepts SINGLE_CELL and FULL_GRID. Round 2 cell
  // updates go through the socket event round2_cell_update, not the REST
  // /api/submissions endpoint. Testing that requires a Socket.IO client.
  console.log('\n=== TEST 7: Cell update via socket (SKIPPED — requires Socket.IO client) ===');

  // TEST 8: Round 2 end and cleanup.
  console.log('\n=== TEST 8: Round 2 end and cleanup ===');
  await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND2_RELAY}/end`, null, j);
  const afterEnd = (await request('GET', `/api/tournaments/${tid}/my-state`, null, pTokens.player1)).data;
  check('No current round after R2 end', !afterEnd?.currentRound);

  // TEST 9: Round 3 still works (regression check).
  console.log('\n=== TEST 9: Round 3 still works (no regression) ===');
  const r3Start = await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND3_COLLABORATE}/start`, null, j);
  check('R3 starts successfully', r3Start.code === 200);
  await request('POST', `/api/tournaments/${tid}/rounds/${roundIds.ROUND3_COLLABORATE}/end`, null, j);

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
