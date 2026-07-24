const Database = require('./server/node_modules/sql.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const options = { hostname: 'localhost', port: 3001, path: urlPath, method, headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Round 1 End-to-End Verification (DB-based) ===\n');

  // 1. Login as admin
  let r = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = r.data?.token;
  console.log('1. Admin login:', r.code === 200 ? 'OK' : 'FAILED');

  // 2. Create tournament
  r = await request('POST', '/api/tournaments', { name: 'R1 Verify Final', description: 'E2E test' }, adminToken);
  const tournamentId = r.data?.id;
  console.log('2. Create tournament:', r.code === 200 ? `OK (id=${tournamentId})` : 'FAILED');

  // 3. Create 3 rounds
  const roundTypes = ['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE'];
  const roundNames = ['Round 1: Nine-in-One', 'Round 2: Relay', 'Round 3: Collaborate'];
  const roundDurations = [1800, 2400, 1800];
  const roundIds = [];
  for (let i = 0; i < 3; i++) {
    r = await request('POST', `/api/tournaments/${tournamentId}/rounds`, {
      name: roundNames[i], roundType: roundTypes[i], roundNumber: i + 1, durationSeconds: roundDurations[i]
    }, adminToken);
    roundIds.push(r.data?.id);
    console.log(`3.${i+1}. Create round ${i+1}:`, r.code === 200 ? `OK (id=${r.data?.id})` : 'FAILED');
  }

  // 4. Generate & import puzzles
  for (let i = 0; i < 3; i++) {
    const rt = roundTypes[i];
    const count = rt === 'ROUND1_NINE_ONE' ? 10 : rt === 'ROUND2_RELAY' ? 4 : 1;
    r = await request('POST', '/api/puzzle-bank/generate', { roundType: rt, count }, adminToken);
    console.log(`4.${i+1}a. Generate ${rt}:`, r.code === 200 ? `OK (${r.data?.generated})` : `FAILED`);
    r = await request('POST', '/api/puzzle-bank/import-to-round', { roundId: roundIds[i], count }, adminToken);
    console.log(`4.${i+1}b. Import to round ${i+1}:`, r.code === 200 ? `OK (${r.data?.imported})` : `FAILED: ${r.message}`);
  }

  // 5. Create teams
  const teamIds = [];
  for (let i = 0; i < 2; i++) {
    r = await request('POST', `/api/tournaments/${tournamentId}/teams`, { name: `Team ${i+1}` }, adminToken);
    teamIds.push(r.data?.id);
    console.log(`5.${i+1}. Create team ${i+1}:`, r.code === 200 ? `OK (id=${r.data?.id})` : 'FAILED');
  }

  // 6. Create players
  const playerIds = [];
  const playerCreds = [];
  for (let i = 0; i < 4; i++) {
    const username = `r1v${i+1}_${Date.now()}`;
    r = await request('POST', '/api/users', { username, password: 'test1234', role: 'PLAYER', displayName: `Player ${i+1}` }, adminToken);
    playerIds.push(r.data?.id);
    playerCreds.push({ username, password: 'test1234' });
    console.log(`6.${i+1}. Create player ${username}:`, r.code === 200 ? `OK (id=${r.data?.id})` : 'FAILED');
  }

  // 7. Login players
  const playerTokens = [];
  for (const cred of playerCreds) {
    r = await request('POST', '/api/auth/login', { username: cred.username, password: cred.password });
    playerTokens.push(r.data?.token);
  }
  console.log('7. Players logged in:', playerTokens.filter(Boolean).length + '/4');

  // 8. Assign to teams
  for (let i = 0; i < 4; i++) {
    const teamId = teamIds[i < 2 ? 0 : 1];
    r = await request('POST', `/api/teams/${teamId}/members`, { playerId: playerIds[i] }, adminToken);
  }
  console.log('8. Players assigned to teams');

  // 9. Assign judge
  r = await request('POST', `/api/tournaments/${tournamentId}/judges`, { judgeId: 1 }, adminToken);
  console.log('9. Judge assigned:', r.code === 200 ? 'OK' : 'FAILED');

  // 10. Start tournament + Round 1
  r = await request('POST', `/api/tournaments/${tournamentId}/start`, null, adminToken);
  console.log('10. Start tournament:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[0]}/start`, null, adminToken);
  console.log('11. Start Round 1:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  // 12. Read puzzle solutions directly from DB
  const SQL = await Database();
  const dbPath = path.join(__dirname, 'server', 'data', 'sudoku.db');
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  const puzzleResult = db.exec('SELECT id, puzzle_type, letter, initial_grid, solution FROM puzzles WHERE round_id = ? ORDER BY order_in_round', [roundIds[0]]);
  const cols = puzzleResult[0].columns;
  const puzzleRows = puzzleResult[0].values;
  db.close();

  const puzzleData = puzzleRows.map(row => ({
    id: row[0],
    type: row[1],
    letter: row[2],
    initialGrid: JSON.parse(row[3]),
    solution: JSON.parse(row[4])
  }));

  console.log(`\n12. Loaded ${puzzleData.length} puzzles from DB`);
  const jocPuzzles = puzzleData.filter(p => p.type === 'JOC');
  const finalPuzzle = puzzleData.find(p => p.type === 'FINAL');
  console.log('    JOC:', jocPuzzles.length, '| FINAL:', finalPuzzle ? 'yes' : 'no');

  // 13. Solve all 9 JOC
  console.log('\n13. Solving JOC puzzles...');
  for (const puzzle of jocPuzzles) {
    const ig = puzzle.initialGrid;
    const sol = puzzle.solution;
    let targetRow = -1, targetCol = -1;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (ig[row][col] === 0) { targetRow = row; targetCol = col; break; }
      }
      if (targetRow >= 0) break;
    }
    const correctVal = sol[targetRow][targetCol];

    r = await request('POST', '/api/submissions', {
      roundId: roundIds[0],
      puzzleId: puzzle.id,
      submissionType: 'SINGLE_CELL',
      row: targetRow,
      col: targetCol,
      value: correctVal
    }, playerTokens[0]);

    console.log(`    Puzzle ${puzzle.id} (${puzzle.letter}): isCorrect=${r.data?.isCorrect} pts=${r.data?.pointsEarned} alreadySolved=${r.data?.alreadySolved}`);
  }

  // 14. Check progress
  r = await request('GET', `/api/tournaments/${tournamentId}/my-state`, null, playerTokens[0]);
  const prog = r.data?.round1Progress;
  console.log('\n14. After JOC: jocSolved=' + prog?.jocSolvedCount + '/9 finalUnlocked=' + prog?.finalUnlocked + ' teamScore=' + prog?.teamScore);

  // 15. Submit FINAL puzzle
  if (finalPuzzle && prog?.finalUnlocked) {
    const ig = finalPuzzle.initialGrid;
    const sol = finalPuzzle.solution;
    const fullGrid = ig.map((row, ri) => row.map((cell, ci) => cell !== 0 ? cell : sol[ri][ci]));

    r = await request('POST', '/api/submissions', {
      roundId: roundIds[0],
      puzzleId: finalPuzzle.id,
      submissionType: 'FULL_GRID',
      grid: fullGrid
    }, playerTokens[0]);

    console.log('\n15. FINAL puzzle submission:');
    console.log('    isCorrect:', r.data?.isCorrect);
    console.log('    pointsEarned:', r.data?.pointsEarned);
    console.log('    alreadySolved:', r.data?.alreadySolved);

    if (r.data?.isCorrect && r.data?.pointsEarned === 20 && !r.data?.alreadySolved) {
      console.log('\n    *** SUCCESS! FINAL puzzle returns pointsEarned=20 ***');
    } else if (r.data?.alreadySolved) {
      console.log('\n    *** BUG STILL PRESENT! alreadySolved=true ***');
    } else {
      console.log('\n    *** UNEXPECTED ***');
    }
  } else {
    console.log('\n15. FINAL not unlocked or missing');
  }

  // 16. Final check
  r = await request('GET', `/api/tournaments/${tournamentId}/my-state`, null, playerTokens[0]);
  const fp = r.data?.round1Progress;
  console.log('\n16. Final: jocSolved=' + fp?.jocSolvedCount + ' finalSolved=' + fp?.finalSolved + ' teamScore=' + fp?.teamScore);
  console.log('    Expected teamScore: 200 (9*20 + 20)');

  console.log('\n=== Verification Complete ===');
}

main().catch(e => console.error('Error:', e));
