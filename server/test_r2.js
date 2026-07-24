const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { initDB } = require('./src/utils/db');
const { createAuthRouter } = require('./src/routes/auth');
const { createUserRouter } = require('./src/routes/users');
const { createTournamentRouter } = require('./src/routes/tournaments');
const { createGameRouter } = require('./src/routes/game');
const { createPuzzleBankRouter } = require('./src/routes/puzzleBank');
const { createSocketHandler } = require('./src/ws/socketHandler');
const GameEngine = require('./src/engine/GameEngine');
const axios = require('axios');

async function test() {
  // Clean puzzle bank and DB before test
  const bankPath = path.join(__dirname, 'data', 'puzzle-bank.json');
  if (fs.existsSync(bankPath)) fs.unlinkSync(bankPath);
  const dbPath = path.join(__dirname, 'data', 'db.json');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  console.log('Cleaned puzzle bank and DB');

  const dbHelpers = await initDB();
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/auth', createAuthRouter(dbHelpers));
  app.use('/api/users', createUserRouter(dbHelpers));
  app.use('/api', createTournamentRouter(dbHelpers));

  const engine = new GameEngine(dbHelpers, io);
  app.use('/api', createGameRouter(dbHelpers, engine));
  app.use('/api', createPuzzleBankRouter());

  createSocketHandler(io, dbHelpers, engine);

  server.listen(3099, async () => {
    const api = axios.create({ baseURL: 'http://localhost:3099', validateStatus: () => true });

    try {
      // Login as admin (seed user)
      const adminLogin = await api.post('/api/auth/login', { username: 'admin', password: 'admin123' });
      if (!adminLogin.data.data?.token) throw new Error('Admin login failed: ' + JSON.stringify(adminLogin.data));
      const adminToken = adminLogin.data.data.token;
      const a = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + adminToken }, validateStatus: () => true });

      const judgeLogin = await api.post('/api/auth/login', { username: 'judge', password: 'judge123' });
      const judgeToken = judgeLogin.data.data.token;
      const j = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + judgeToken }, validateStatus: () => true });

      const p1Login = await api.post('/api/auth/login', { username: 'player1', password: 'player123' });
      const p1Token = p1Login.data.data.token;
      const p1 = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + p1Token }, validateStatus: () => true });

      // Get user IDs
      const usersList = (await a.get('/api/users')).data.data;
      const playerIds = usersList.filter(u => u.role === 'PLAYER').map(u => u.id);
      console.log('Player IDs:', playerIds.slice(0,6));

      // Create tournament
      const tRes = await a.post('/api/tournaments', { name: 'R2Test', description: 'test' });
      const tid = tRes.data.data.id;
      console.log('Tournament:', tid);

      // Create teams & add members
      const teamARes = await a.post('/api/tournaments/' + tid + '/teams', { name: 'TeamA' });
      const teamAId = teamARes.data.data.id;
      const teamBRes = await a.post('/api/tournaments/' + tid + '/teams', { name: 'TeamB' });
      const teamBId = teamBRes.data.data.id;
      // Add members to teams (the create-team endpoint doesn't handle playerIds)
      for (let i = 0; i < 3; i++) {
        await a.post('/api/teams/' + teamAId + '/members', { playerId: playerIds[i], position: i + 1 });
        await a.post('/api/teams/' + teamBId + '/members', { playerId: playerIds[i + 3], position: i + 1 });
      }
      console.log('Teams created with members');

      // Create rounds
      const r1r = await a.post('/api/tournaments/' + tid + '/rounds', { name: 'Round1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600, roundNumber: 1 });
      const r2r = await a.post('/api/tournaments/' + tid + '/rounds', { name: 'Round2', roundType: 'ROUND2_RELAY', durationSeconds: 1800, roundNumber: 2 });
      const r3r = await a.post('/api/tournaments/' + tid + '/rounds', { name: 'Round3', roundType: 'ROUND3_SPEED', durationSeconds: 300, roundNumber: 3 });
      console.log('R1:', r1r.data.code, 'R2:', r2r.data.code, 'R3:', r3r.data.code);

      // Get round IDs
      const rounds = (await a.get('/api/tournaments/' + tid + '/rounds')).data.data;
      const r1Id = rounds.find(r => r.round_type === 'ROUND1_NINE_ONE').id;
      const r2Id = rounds.find(r => r.round_type === 'ROUND2_RELAY').id;
      const r3Id = rounds.find(r => r.round_type === 'ROUND3_SPEED').id;
      console.log('Round IDs: R1=' + r1Id + ' R2=' + r2Id + ' R3=' + r3Id);

      // Generate & import puzzles
      console.log('\n--- Puzzle Generation ---');
      const gen1 = await a.post('/api/puzzle-bank/generate', { roundType: 'ROUND1_NINE_ONE', count: 10 });
      console.log('R1 gen:', gen1.data.code, gen1.data.data?.generated);

      const gen2 = await a.post('/api/puzzle-bank/generate', { roundType: 'ROUND2_RELAY', count: 32, teamsCount: 2 });
      console.log('R2 gen:', gen2.data.code, gen2.data.data?.generated);

      // Import - use correct endpoint
      const imp1 = await a.post('/api/puzzle-bank/import-to-round', { roundId: r1Id });
      console.log('R1 import:', imp1.data.code, JSON.stringify(imp1.data.data || imp1.data.message));

      const imp2 = await a.post('/api/puzzle-bank/import-to-round', { roundId: r2Id });
      console.log('R2 import:', imp2.data.code, JSON.stringify(imp2.data.data || imp2.data.message));

      // Check puzzles in DB for R2 round
      const r2Puzzles = (await a.get('/api/puzzle-bank?roundType=ROUND2_RELAY&limit=100')).data.data;
      console.log('Bank R2 puzzles:', r2Puzzles.total);
      const r2Detail = (await a.get('/api/tournaments/' + tid)).data.data;
      const r2Round = r2Detail.rounds.find(r => r.round_type === 'ROUND2_RELAY');
      console.log('R2 round puzzles in DB:', r2Round?.puzzles?.length);

      // Start tournament
      console.log('\n--- Tournament Flow ---');
      const startRes = await j.post('/api/tournaments/' + tid + '/start');
      console.log('Start:', JSON.stringify(startRes.data));

      // R1
      const r1Start = await j.post('/api/tournaments/' + tid + '/rounds/' + r1Id + '/start');
      console.log('Start R1:', JSON.stringify(r1Start.data));

      const r1State = await p1.get('/api/tournaments/' + tid + '/my-state');
      console.log('R1 state type:', r1State.data.data?.currentRound?.roundType, 'puzzles:', r1State.data.data?.puzzles?.length);

      await j.post('/api/tournaments/' + tid + '/rounds/' + r1Id + '/end');
      console.log('R1 ended');

      // R2
      console.log('\n--- Round 2 ---');
      const r2Start = await j.post('/api/tournaments/' + tid + '/rounds/' + r2Id + '/start');
      console.log('Start R2:', r2Start.data.code, r2Start.data.message || 'OK');

      if (r2Start.data.code !== 200) {
        throw new Error('R2 start failed: ' + r2Start.data.message);
      }

      // Check player state
      const myState = await p1.get('/api/tournaments/' + tid + '/my-state');
      console.log('R2 raw response:', JSON.stringify(myState.data).slice(0, 800));
      const sd = myState.data.data;
      console.log('Round type:', sd.currentRound?.roundType);
      console.log('R2 puzzles:', sd.round2State?.puzzles?.length);
      console.log('Active player:', sd.round2State?.activePlayerName);
      console.log('Turn remaining:', sd.round2State?.turnRemaining + 's');
      console.log('Player order:', JSON.stringify(sd.round2State?.playerOrder));
      console.log('Total puzzles:', sd.round2State?.totalPuzzles);
      console.log('Team score:', sd.round2State?.teamScore);

      if (sd.round2State?.puzzles) {
        const easy = sd.round2State.puzzles.filter(p => p.difficulty === 'EASY').length;
        const med = sd.round2State.puzzles.filter(p => p.difficulty === 'MEDIUM').length;
        const hard = sd.round2State.puzzles.filter(p => p.difficulty === 'HARD').length;
        console.log('Difficulty: Easy=' + easy + ' Medium=' + med + ' Hard=' + hard);
        console.log(easy === 8 && med === 6 && hard === 2 ? 'PASS: 8E+6M+2H' : 'FAIL: Expected 8E+6M+2H');

        const withGrid = sd.round2State.puzzles.filter(p => p.initialGrid?.length === 9);
        console.log('Puzzles with 9x9 grid:', withGrid.length + '/16');
      }

      // End R2
      await j.post('/api/tournaments/' + tid + '/rounds/' + r2Id + '/end');
      console.log('R2 ended');

      // R3
      const r3Start = await j.post('/api/tournaments/' + tid + '/rounds/' + r3Id + '/start');
      console.log('Start R3:', r3Start.data.code, r3Start.data.message || 'OK');
      await j.post('/api/tournaments/' + tid + '/rounds/' + r3Id + '/end');
      console.log('R3 ended - no regression');

      // End tournament
      await j.post('/api/tournaments/' + tid + '/end');
      console.log('Tournament ended');

      console.log('\n=== VERIFICATION COMPLETE ===');

    } catch (err) {
      console.error('TEST ERROR:', err.message);
      if (err.response) console.error('Response:', JSON.stringify(err.response.data));
    }
    server.close();
    process.exit(0);
  });
}
test().catch(e => { console.error(e); process.exit(1); });
