// End-to-end test for Round 2 (Relay) flow.
// Rebuilt to match the current PostgreSQL + GameOrchestrator architecture:
//   - Talks to an already-running server on port 3001 (like test-round1-e2e.js)
//   - Uses Node's built-in http module instead of axios (not installed)
//   - Uses ROUND3_COLLABORATE (ROUND3_SPEED was the old invalid enum)
//   - Drops the legacy SQLite db.json cleanup (PostgreSQL now)

// Load server env so any config the routes read is available.
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

async function main() {
  console.log('=== Round 2 (Relay) End-to-End Verification ===\n');

  // 1. Login as admin, judge, and a player.
  let r = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = r.data?.token;
  console.log('1. Admin login:', adminToken ? 'OK' : 'FAILED');

  r = await request('POST', '/api/auth/login', { username: 'judge', password: 'judge123' });
  const judgeToken = r.data?.token;
  console.log('2. Judge login:', judgeToken ? 'OK' : 'FAILED');

  r = await request('POST', '/api/auth/login', { username: 'player1', password: 'player123' });
  const playerToken = r.data?.token;
  console.log('3. Player1 login:', playerToken ? 'OK' : 'FAILED');

  // 4. List users to find player IDs.
  r = await request('GET', '/api/users', null, adminToken);
  const playerIds = r.data?.filter(u => u.role === 'PLAYER').map(u => u.id) || [];
  console.log('4. Player IDs:', playerIds.slice(0, 6));

  // 5. Create tournament.
  r = await request('POST', '/api/tournaments', { name: 'R2 Verify', description: 'E2E test' }, adminToken);
  const tournamentId = r.data?.id;
  console.log('5. Create tournament:', r.code === 200 ? `OK (id=${tournamentId})` : `FAILED: ${r.message}`);

  // 6. Create 2 teams and add 3 players to each.
  const teamIds = [];
  for (let i = 0; i < 2; i++) {
    r = await request('POST', `/api/tournaments/${tournamentId}/teams`, { name: `Team ${i + 1}` }, adminToken);
    teamIds.push(r.data?.id);
    console.log(`6.${i + 1}. Create team ${i + 1}:`, r.code === 200 ? `OK (id=${r.data?.id})` : 'FAILED');
  }
  for (let i = 0; i < 3; i++) {
    await request('POST', `/api/teams/${teamIds[0]}/members`, { playerId: playerIds[i], position: i + 1 }, adminToken);
    await request('POST', `/api/teams/${teamIds[1]}/members`, { playerId: playerIds[i + 3], position: i + 1 }, adminToken);
  }
  console.log('6b. Players assigned to teams');

  // 7. Create 3 rounds (R1, R2, R3). R3 uses ROUND3_COLLABORATE (not ROUND3_SPEED).
  const roundTypes = ['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE'];
  const roundDurations = [600, 1800, 300];
  const roundIds = [];
  for (let i = 0; i < 3; i++) {
    r = await request('POST', `/api/tournaments/${tournamentId}/rounds`, {
      name: `Round ${i + 1}`,
      roundType: roundTypes[i],
      durationSeconds: roundDurations[i],
      roundNumber: i + 1
    }, adminToken);
    roundIds.push(r.data?.id);
    console.log(`7.${i + 1}. Create round ${i + 1} (${roundTypes[i]}):`, r.code === 200 ? `OK (id=${r.data?.id})` : `FAILED: ${r.message}`);
  }

  // 8. Generate and import puzzles for R1 and R2.
  r = await request('POST', '/api/puzzle-bank/generate', { roundType: 'ROUND1_NINE_ONE', count: 10 }, adminToken);
  console.log('8a. Generate R1 puzzles:', r.code === 200 ? `OK (${r.data?.generated})` : `FAILED: ${r.message}`);
  r = await request('POST', '/api/puzzle-bank/generate', { roundType: 'ROUND2_RELAY', count: 32, teamsCount: 2 }, adminToken);
  console.log('8b. Generate R2 puzzles:', r.code === 200 ? `OK (${r.data?.generated})` : `FAILED: ${r.message}`);
  r = await request('POST', '/api/puzzle-bank/import-to-round', { roundId: roundIds[0], count: 10 }, adminToken);
  console.log('8c. Import R1 puzzles:', r.code === 200 ? `OK (${r.data?.imported})` : `FAILED: ${r.message}`);
  r = await request('POST', '/api/puzzle-bank/import-to-round', { roundId: roundIds[1], count: 32 }, adminToken);
  console.log('8d. Import R2 puzzles:', r.code === 200 ? `OK (${r.data?.imported})` : `FAILED: ${r.message}`);

  // 9. Start tournament, R1, then end R1.
  r = await request('POST', `/api/tournaments/${tournamentId}/start`, null, judgeToken);
  console.log('9. Start tournament:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[0]}/start`, null, judgeToken);
  console.log('10. Start R1:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[0]}/end`, null, judgeToken);
  console.log('11. End R1:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  // 12. Start R2 and read player state.
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[1]}/start`, null, judgeToken);
  console.log('12. Start R2:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  r = await request('GET', `/api/tournaments/${tournamentId}/my-state`, null, playerToken);
  const sd = r.data;
  console.log('\n13. R2 player state:');
  console.log('    roundType:', sd?.currentRound?.roundType);
  console.log('    R2 puzzles count:', sd?.round2State?.puzzles?.length);
  console.log('    active player:', sd?.round2State?.activePlayerName);
  console.log('    turnRemaining:', sd?.round2State?.turnRemaining + 's');
  console.log('    playerOrder:', JSON.stringify(sd?.round2State?.playerOrder));
  console.log('    totalPuzzles:', sd?.round2State?.totalPuzzles);
  console.log('    teamScore:', sd?.round2State?.teamScore);

  if (sd?.round2State?.puzzles) {
    const easy = sd.round2State.puzzles.filter(p => p.difficulty === 'EASY').length;
    const med = sd.round2State.puzzles.filter(p => p.difficulty === 'MEDIUM').length;
    const hard = sd.round2State.puzzles.filter(p => p.difficulty === 'HARD').length;
    console.log(`    Difficulty: Easy=${easy} Medium=${med} Hard=${hard}`);
    const withGrid = sd.round2State.puzzles.filter(p => p.initialGrid?.length === 9).length;
    console.log(`    Puzzles with 9x9 grid: ${withGrid}/${sd.round2State.puzzles.length}`);
  }

  // 14. End R2, start/end R3 (regression check), end tournament.
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[1]}/end`, null, judgeToken);
  console.log('\n14. End R2:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[2]}/start`, null, judgeToken);
  console.log('15. Start R3:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);
  r = await request('POST', `/api/tournaments/${tournamentId}/rounds/${roundIds[2]}/end`, null, judgeToken);
  console.log('16. End R3:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  r = await request('POST', `/api/tournaments/${tournamentId}/end`, null, judgeToken);
  console.log('17. End tournament:', r.code === 200 ? 'OK' : `FAILED: ${r.message}`);

  console.log('\n=== Verification Complete ===');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
