// Seed demo data script
// Run: node seed-demo.js

const API = 'http://localhost:3001/api';

async function request(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

async function main() {
  console.log('=== Seeding Demo Data ===\n');

  // 1. Login as admin
  console.log('1. Logging in as admin...');
  const loginRes = await request('POST', '/auth/login', null, { username: 'admin', password: 'admin123' });
  if (loginRes.code !== 200) { console.error('Login failed:', loginRes); return; }
  const token = loginRes.data.token;
  console.log('   Admin logged in.\n');

  // 2. Create tournament
  console.log('2. Creating tournament...');
  const tRes = await request('POST', '/tournaments', token, {
    name: '2026 Sudoku Championship Demo',
    description: 'Demo tournament for the Sudoku Arena platform'
  });
  if (tRes.code !== 200) { console.error('Create tournament failed:', tRes); return; }
  const tid = tRes.data.id;
  console.log(`   Tournament created: ID=${tid}\n`);

  // 3. Create rounds
  console.log('3. Creating rounds...');
  const rounds = [
    { name: 'Round 1: Nine-One', roundType: 'ROUND1_NINE_ONE', durationSeconds: 300 },
    { name: 'Round 2: Relay', roundType: 'ROUND2_RELAY', durationSeconds: 600 },
    { name: 'Round 3: Collaborate', roundType: 'ROUND3_COLLABORATE', durationSeconds: 480 },
  ];
  const roundIds = [];
  for (const r of rounds) {
    const rRes = await request('POST', `/tournaments/${tid}/rounds`, token, r);
    if (rRes.code === 200) {
      roundIds.push(rRes.data.id);
      console.log(`   ${r.name}: ID=${rRes.data.id}`);
    } else {
      console.error(`   Failed: ${r.name}`, rRes.message);
    }
  }
  console.log();

  // 4. Import puzzles for each round
  console.log('4. Importing puzzles...');
  for (let ri = 0; ri < roundIds.length; ri++) {
    const roundId = roundIds[ri];
    const roundType = rounds[ri].roundType;
    const puzzles = generatePuzzles(roundType);
    const pRes = await request('POST', `/rounds/${roundId}/puzzles/import`, token, { puzzles });
    if (pRes.code === 200) {
      console.log(`   Round ${ri + 1}: ${pRes.data.successCount} puzzles imported`);
    } else {
      console.error(`   Round ${ri + 1} failed:`, pRes.message);
    }
  }
  console.log();

  // 5. Create teams
  console.log('5. Creating teams...');
  const teamNames = ['Alpha Dragons', 'Beta Phoenix', 'Gamma Thunder', 'Delta Storm'];
  const teamIds = [];
  for (const name of teamNames) {
    const tRes = await request('POST', `/tournaments/${tid}/teams`, token, { name });
    if (tRes.code === 200) {
      teamIds.push(tRes.data.id);
      console.log(`   ${name}: ID=${tRes.data.id}`);
    }
  }
  console.log();

  // 6. Add players to teams
  console.log('6. Adding players to teams...');
  const playerIds = [3, 4, 5, 6, 7, 8, 9, 10]; // player1-player8
  for (let ti = 0; ti < teamIds.length; ti++) {
    const p1 = playerIds[ti * 2];
    const p2 = playerIds[ti * 2 + 1];
    if (p1) {
      await request('POST', `/teams/${teamIds[ti]}/members`, token, { playerId: p1, position: 1 });
      console.log(`   Player${p1 - 2} -> Team ${teamNames[ti]}`);
    }
    if (p2) {
      await request('POST', `/teams/${teamIds[ti]}/members`, token, { playerId: p2, position: 2 });
      console.log(`   Player${p2 - 2} -> Team ${teamNames[ti]}`);
    }
  }
  console.log();

  // 7. Assign judge
  console.log('7. Assigning judge...');
  const jRes = await request('POST', `/tournaments/${tid}/judges`, token, { judgeId: 2 });
  if (jRes.code === 200) console.log('   Judge assigned.\n');
  else console.log('   Judge assign failed:', jRes.message, '\n');

  console.log('=== Demo data seeded successfully! ===');
  console.log(`\nTournament ID: ${tid}`);
  console.log('\nTest accounts:');
  console.log('  Admin:  admin / admin123');
  console.log('  Judge:  judge / judge123');
  console.log('  Player: player1-player8 / player123');
  console.log('\nOpen http://localhost:5173 to start!');
}

function generatePuzzles(roundType) {
  const puzzles = [];
  const count = roundType === 'ROUND1_NINE_ONE' ? 9 : roundType === 'ROUND2_RELAY' ? 4 : 1;

  for (let i = 0; i < count; i++) {
    const solution = generateSudokuSolution(i);
    let emptyCount;
    if (roundType === 'ROUND1_NINE_ONE') emptyCount = 1;
    else if (roundType === 'ROUND2_RELAY') emptyCount = 25;
    else emptyCount = 40;

    const initial = removeCells(solution, emptyCount);

    puzzles.push({
      type: roundType === 'ROUND1_NINE_ONE' ? 'JOC' : 'STANDARD',
      order: i + 1,
      initialGrid: initial,
      solution,
      points: 100,
      letter: roundType === 'ROUND1_NINE_ONE' ? String.fromCharCode(65 + i) : null,
    });
  }
  return puzzles;
}

function generateSudokuSolution(seed) {
  const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const grid = [];

  // Generate a valid sudoku using shifted rows with different shifts per seed
  const shiftPattern = [
    [0, 3, 6, 1, 4, 7, 2, 5, 8],
    [0, 3, 6, 2, 5, 8, 1, 4, 7],
    [0, 3, 6, 1, 4, 7, 2, 5, 8],
  ];

  const pattern = shiftPattern[seed % shiftPattern.length];

  for (let row = 0; row < 9; row++) {
    const shift = pattern[row];
    grid.push([...base.slice(shift), ...base.slice(0, shift)]);
  }

  return grid;
}

function removeCells(solution, count) {
  const grid = solution.map(row => [...row]);
  let removed = 0;
  const positions = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      positions.push([r, c]);
    }
  }
  // Shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  for (const [r, c] of positions) {
    if (removed >= count) break;
    if (grid[r][c] !== 0) {
      grid[r][c] = 0;
      removed++;
    }
  }
  return grid;
}

main().catch(console.error);
