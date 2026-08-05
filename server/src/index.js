const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const { initDB, getRepos } = require('./utils/db');
const { createAuthRouter } = require('./routes/auth');
const { createUserRouter } = require('./routes/users');
const { createTournamentRouter } = require('./routes/tournaments');
const { createGameRouter } = require('./routes/game');
const { createPuzzleBankRouter } = require('./routes/puzzleBank');
const { createParticipantRouter } = require('./routes/participants');
const EmissionBus = require('./ws/EmissionBus');
const SocketManager = require('./ws/SocketManager');
const GameOrchestrator = require('./engine/GameOrchestrator');
const { createStateRepository } = require('./state');
const config = require('./config');

async function main() {
  await initDB();
  const repos = getRepos();
  const state = createStateRepository();

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: config.CORS_ORIGINS, methods: ['GET', 'POST'] }
  });

  // Security headers on every response (clickjacking, MIME-sniffing, etc.).
  // CSP is left off for now — it needs per-asset tuning for the Vite/React SPA
  // and Socket.IO before we enable it during production hardening.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
  }));

  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint for monitoring
  app.get('/api/health', async (req, res) => {
    try {
      const db = repos.UserRepository ? 'ok' : 'error';
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: db,
        environment: config.NODE_ENV
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Health check failed'
      });
    }
  });

  // Mount routes — all receive repos instead of raw dbHelpers
  app.use('/api/auth', createAuthRouter(repos));
  app.use('/api/users', createUserRouter(repos));
  app.use('/api', createTournamentRouter(repos));

  // Create EmissionBus and GameOrchestrator
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);
  app.use('/api', createGameRouter(repos, orchestrator));
  app.use('/api', createPuzzleBankRouter(repos));
  app.use('/api', createParticipantRouter(repos));

  // Setup WebSocket via SocketManager (replaces socketHandler)
  new SocketManager(io, repos, orchestrator, bus);

  // Serve frontend static files
  const path = require('path');
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  // SPA fallback: serve index.html for any non-API route
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });

  const PORT = config.PORT;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
