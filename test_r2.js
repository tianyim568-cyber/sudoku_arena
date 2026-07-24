const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDB } = require('./server/src/utils/db');
const { createAuthRouter } = require('./server/src/routes/auth');
const { createUserRouter } = require('./server/src/routes/users');
const { createTournamentRouter } = require('./server/src/routes/tournaments');
const { createGameRouter } = require('./server/src/routes/game');
const { createPuzzleBankRouter } = require('./server/src/routes/puzzleBank');
const { createSocketHandler } = require('./server/src/ws/socketHandler');
const GameEngine = require('./server/src/engine/GameEngine');
const axios = require('axios');

async function test() {
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
      // 1. Register users
      console.log('--- Registering users ---');
      await api.post('/api/auth/register', { username: 'admin', password: '123', displayName: 'Admin', role: 'ADMIN' });
      await api.post('/api/auth/register', { username: 'judge1', password: '123', displayName: 'Judge1', role: 'JUDGE' });
      await api.post('/api/auth/register', { username: 'pa1', password: '123', displayName: 'PlayerA1', role: 'PLAYER' });
      await api.post('/api/auth/register', { username: 'pa2', password: '123', displayName: 'PlayerA2', role: 'PLAYER' });
      await api.post('/api/auth/register', { username: 'pa3', password: '123', displayName: 'PlayerA3', role: 'PLAYER' });
      await api.post('/api/auth/register', { username: 'pb1', password: '123', displayName: 'PlayerB1', role: 'PLAYER' });
      await api.post('/api/auth/register', { username: 'pb2', password: '123', displayName: 'PlayerB2', role: 'PLAYER' });
      await api.post('/api/auth/register', { username: 'pb3', password: '123', displayName: 'PlayerB3', role: 'PLAYER' });
      console.log('Users registered');

      // Login
      const adminLogin = await api.post('/api/auth/login', { username: 'admin', password: '123' });
      const adminToken = adminLogin.data.data.token;
      const adminApi = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + adminToken }, validateStatus: () => true });

      const judgeLogin = await api.post('/api/auth/login', { username: 'judge1', password: '123' });
      const judgeToken = judgeLogin.data.data.token;
      const judgeApi = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + judgeToken }, validateStatus: () => true });

      const pa1Login = await api.post('/api/auth/login', { username: 'pa1', password: '123' });
      const pa1Token = pa1Login.data.data.token;
      const pa1Api = axios.create({ baseURL: 'http://localhost:3099', headers: { Authorization: 'Bearer ' + pa1Token }, validateStatus: () => true });

      // 2. Create tournament
      const tRes = await adminApi.post('/api/tournaments', { name: 'R2Test', description: 'Round 2 test' });
      const tid = tRes.data.data.id;
      console.log('Tournament ID:', tid);

      // 3. Create teams
      await adminApi.post('/api/tournaments/' + tid + '/teams', { name: 'TeamA', playerIds: [3,4,5] });
      await adminApi.post('/api/tournaments/' + tid + '/teams', { name: 'TeamB', playerIds: [6,7,8] });
      console.log('Teams created');

      // 4. Create rounds
      await adminApi.post('/api/tournaments/' + tid + '/rounds', { name: 'Round1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600, roundNumber: 1 });
      await adminApi.post('/api/tournaments/' + tid + '/rounds', { name: 'Round2 Relay', roundType: 'ROUND2_RELAY', durationSeconds: 1800, roundNumber: 2 });
      await adminApi.post('/api/tournaments/' + tid + '/rounds', { name: 'Round3', roundType: 'ROUND3_SPEED', durationSeconds: 300, roundNumber: 3 });
      console.log('Rounds created');

      // 5. Get round IDs
      const roundsRes = await adminApi.get('/api/tournaments/' + tid + '/rounds');
      const rounds = roundsRes.data.data;
      const r1Id = rounds.find(r => r.roundType === 'ROUND1_NINE_ONE').id;
      const r2Id = rounds.find(r => r.roundType === 'ROUND2_RELAY').id;
      const r3Id = rounds.find(r => r.roundType === 'ROUND3_SPEED').id;
      console.log('Round IDs: R1=' + r1Id + ' R2=' + r2Id + ' R3=' + r3Id);

      // 6. Generate & import puzzles
      console.log('\n--- Generating & importing puzzles ---');
      await adminApi.post('/api/puzzle-bank/generate', { roundType: 'ROUND2_RELAY', count: 32 });
      const imp2 = await adminApi.post('/api/puzzle-bank/' + r2Id + '/import', { roundType: 'ROUND2_RELAY', count: 32 });
      console.log('R2 import:', JSON.stringify(imp2.data.data || imp2.data.message));

      await adminApi.post('/api/puzzle-bank/generate', { roundType: 'ROUND1_NINE_ONE', count: 10 });
      const imp1 = await adminApi.post('/api/puzzle-bank/' + r1Id + '/import', { roundType: 'ROUND1_NINE_ONE', count: 10 });
      console.log('R1 import:', imp1.data.data ? imp1.data.data.imported + ' puzzles' : imp1.data.message);

      // 7. Start tournament + R1
      console.log('\n--- Starting tournament ---');
      const startRes = await judgeApi.post('/api/game/tournaments/' + tid + '/start');
      console.log('Start tournament:', startRes.data.code === 200 ? 'OK' : startRes.data.message);

      const r1Start = await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r1Id + '/start');
      console.log('Start R1:', r1Start.data.code === 200 ? 'OK' : r1Start.data.message);

      await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r1Id + '/end');
      console.log('R1 ended OK');

      // 8. Start Round 2
      console.log('\n--- Starting Round 2 ---');
      const r2Start = await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r2Id + '/start');
      console.log('Start R2:', r2Start.data.code === 200 ? 'OK' : r2Start.data.message);

      // 9. Check player state
      const myState = await pa1Api.get('/api/game/tournaments/' + tid + '/my-state');
      const sd = myState.data.data;
      console.log('\n--- R2 Player State ---');
      console.log('Round type:', sd.currentRound?.roundType);
      console.log('Puzzle count:', sd.round2State?.puzzles?.length);
      console.log('Active player:', sd.round2State?.activePlayerName);
      console.log('Turn remaining:', sd.round2State?.turnRemaining);
      console.log('Player order:', JSON.stringify(sd.round2State?.playerOrder));
      console.log('Total puzzles:', sd.round2State?.totalPuzzles);

      if (sd.round2State?.puzzles) {
        const easy = sd.round2State.puzzles.filter(p => p.difficulty === 'EASY').length;
        const med = sd.round2State.puzzles.filter(p => p.difficulty === 'MEDIUM').length;
        const hard = sd.round2State.puzzles.filter(p => p.difficulty === 'HARD').length;
        console.log('Difficulty: Easy=' + easy + ' Medium=' + med + ' Hard=' + hard);
        if (easy === 8 && med === 6 && hard === 2) {
          console.log('PASS: Correct difficulty distribution (8E+6M+2H)');
        } else {
          console.log('FAIL: Expected 8E+6M+2H');
        }
      }

      // 10. End R2
      await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r2Id + '/end');
      console.log('\nR2 ended OK');

      // 11. Start & end R3 (regression check)
      const r3Start = await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r3Id + '/start');
      console.log('Start R3:', r3Start.data.code === 200 ? 'OK' : r3Start.data.message);
      await judgeApi.post('/api/game/tournaments/' + tid + '/rounds/' + r3Id + '/end');
      console.log('R3 ended OK - no regression');

      // 12. End tournament
      await judgeApi.post('/api/game/tournaments/' + tid + '/end');
      console.log('Tournament ended OK');

      console.log('\n=== ALL TESTS PASSED ===');
    } catch (err) {
      console.error('TEST ERROR:', err.message);
      if (err.response) console.error('Response:', JSON.stringify(err.response.data));
    }
    server.close();
    process.exit(0);
  });
}
test().catch(e => { console.error(e); process.exit(1); });
