const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const { initDB, getRepos, getHelpers } = require('./utils/db');
const { createAuthRouter } = require('./routes/auth');
const { createUserRouter } = require('./routes/users');
const { createCompetitionRouter } = require('./routes/competitions');
const { createDisplayRouter } = require('./routes/display');
// TODO: These routes are disabled until rewritten for the new UUID-based schema (migration 018+).
// The deprecated repositories they depend on query tables that were dropped.
// Re-enable after creating new route files backed by updated repositories.
// const { createTournamentRouter } = require('./routes/tournaments');
// const { createGameRouter } = require('./routes/game');
// const { createPuzzleBankRouter } = require('./routes/puzzleBank');
// const { createParticipantRouter } = require('./routes/participants');
const EmissionBus = require('./ws/EmissionBus');
const SocketManager = require('./ws/SocketManager');
const GameOrchestrator = require('./engine/GameOrchestrator');
const DisplayManager = require('./engine/DisplayManager');
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
  // CSP only governs pages Express itself serves — in dev the SPA is served by
  // Vite, so these directives apply to the production build. connectSrc allows
  // ws:/wss: for Socket.IO.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    // The client runs on another origin in dev and must be able to load these.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // -> X-Frame-Options: DENY (anti-clickjacking)
    frameguard: { action: 'deny' },
  }));

  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint for monitoring
  app.get('/api/health', async (req, res) => {
    try {
      // Probe the database with a trivial query so the reported status
      // reflects live reachability, not just that the repos object exists.
      let db = 'error';
      try {
        const helpers = getHelpers();
        if (helpers) {
          await helpers.get('SELECT 1');
          db = 'ok';
        }
      } catch (dbErr) {
        console.error('Health check DB probe failed:', dbErr.message);
      }

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
  app.use('/api/competitions', createCompetitionRouter(repos));

  // TODO: Disabled until rewritten for new UUID-based schema.
  // app.use('/api', createTournamentRouter(repos));

  // Create EmissionBus and GameOrchestrator
  const bus = new EmissionBus();
  const orchestrator = new GameOrchestrator(repos, state, bus);
  const displayManager = new DisplayManager(repos, bus);

  // Mount display routes
  app.use('/api', createDisplayRouter(displayManager));

  // app.use('/api', createGameRouter(repos, orchestrator));
  // app.use('/api', createPuzzleBankRouter(repos));
  // app.use('/api', createParticipantRouter(repos));

  // Setup WebSocket via SocketManager (replaces socketHandler)
  new SocketManager(io, repos, orchestrator, bus);

  // Serve frontend static files
  const path = require('path');
  const fs = require('fs');
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  const indexHtml = path.join(clientDist, 'index.html');
  const hasFrontend = fs.existsSync(indexHtml);
  if (hasFrontend) {
    app.use(express.static(clientDist));
  }
  // SPA fallback: serve index.html for any non-API route.
  // Unknown /api paths must answer here, not fall through silently — otherwise
  // the connection stays open until the client times out.
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      // Standard envelope, so the client's { code, message, data } contract holds.
      return res.status(404).json({ code: 404, message: 'Interface not found', data: null });
    }
    if (hasFrontend) {
      return res.sendFile(indexHtml);
    }
    return res.status(404).json({ error: 'Frontend not built' });
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
