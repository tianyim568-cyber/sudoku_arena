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
const { createAdminRouter } = require('./routes/admin');
// TODO: These routes are disabled until rewritten for the new UUID-based schema (migration 018+).
// The deprecated repositories they depend on query tables that were dropped.
// Re-enable after creating new route files backed by updated repositories.
const { createCompetitionSetupRouter } = require('./routes/competitionSetup');
const { createGameRouter } = require('./routes/game');
const { createPuzzleBankRouter } = require('./routes/puzzleBank');
const { createParticipantRouter } = require('./routes/participants');
const { createMonitoringRouter } = require('./routes/monitoring');
const EmissionBus = require('./ws/EmissionBus');
const SocketManager = require('./ws/SocketManager');
const GameOrchestrator = require('./engine/GameOrchestrator');
const DisplayManager = require('./engine/DisplayManager');
const PresenceService = require('./services/PresenceService');
const { createStateRepository } = require('./state');
const config = require('./config');
const logger = require('./utils/logger');

async function main() {
  await initDB();
  const repos = getRepos();
  const state = createStateRepository();

  // ─── Startup recovery: reconcile orphaned state from previous crashes ───
  // After a crash, in-memory state (timers, heartbeats, round engines) is gone.
  // But DB records may still show rounds as IN_PROGRESS or competitions as RUNNING
  // with no active connections. We detect and log these on startup so admins know.
  try {
    const prisma = require('./db/prisma').getPrisma();

    // 1. Find rounds stuck in IN_PROGRESS (should have been ended or are orphaned)
    const orphanedRounds = await prisma.rounds.findMany({
      where: { status: 'IN_PROGRESS' },
      select: { id: true, name: true, type: true, started_at: true, competition_stages: { select: { competition_id: true } } },
    });
    if (orphanedRounds.length > 0) {
      logger.warn('Startup recovery: found orphaned IN_PROGRESS rounds (likely from previous crash)', {
        count: orphanedRounds.length,
        rounds: orphanedRounds.map(r => ({
          id: r.id,
          name: r.name,
          type: r.type,
          competitionId: r.competition_stages?.competition_id,
          startedAt: r.started_at,
        })),
      });
      // Auto-end orphaned rounds so competitions can continue
      await prisma.rounds.updateMany({
        where: { status: 'IN_PROGRESS' },
        data: { status: 'FINISHED', ended_at: new Date() },
      });
      logger.info(`Startup recovery: marked ${orphanedRounds.length} orphaned rounds as FINISHED`);
    }

    // 2. Find competitions stuck in RUNNING with no IN_PROGRESS rounds
    const runningCompetitions = await prisma.competitions.findMany({
      where: {
        status: 'RUNNING',
        competition_stages: {
          none: {
            rounds: { some: { status: 'IN_PROGRESS' } }
          }
        }
      },
      select: { id: true, name: true },
    });
    if (runningCompetitions.length > 0) {
      logger.warn('Startup recovery: found RUNNING competitions with no active rounds', {
        count: runningCompetitions.length,
        competitions: runningCompetitions.map(c => ({ id: c.id, name: c.name })),
      });
    }
  } catch (recoveryErr) {
    logger.error('Startup recovery failed (non-fatal)', { error: recoveryErr.message });
  }

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: config.CORS_ORIGINS, methods: ['GET', 'POST'] },
    // 30s ping interval + 30s timeout: generous enough to survive Vite proxy
    // idle gaps and network hiccups without triggering unnecessary reconnects.
    pingInterval: 30000,
    pingTimeout: 30000,
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
        logger.warn('Health check DB probe failed', { error: dbErr.message });
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

  // Create EmissionBus, DisplayManager, and GameOrchestrator before mounting
  // the competition routes — createCompetitionRouter needs displayManager for
  // the GET /:id/results endpoint (admin results page reuses the big-screen
  // snapshot instead of a second code path that would drift apart).
  const bus = new EmissionBus();
  const displayManager = new DisplayManager(repos, bus);
  const orchestrator = new GameOrchestrator(repos, state, bus, displayManager);

  // Create PresenceService for monitoring stale heartbeats
  const presenceService = new PresenceService(state, bus);
  presenceService.start();

  // Mount routes — all receive repos instead of raw dbHelpers
  app.use('/api/auth', createAuthRouter(repos));
  app.use('/api/users', createUserRouter(repos));
  app.use('/api/competitions', createCompetitionRouter(repos, displayManager));

  // Competition setup routes (rounds, puzzles, teams, judges). The CRUD
  // competition routes live in routes/competitions.js (mounted above).
  app.use('/api', createCompetitionSetupRouter(repos));

  // Mount display routes
  app.use('/api', createDisplayRouter(displayManager));

  // Super Admin routes — platform-wide read-only overview. Mounted after
  // the display routes; the router itself enforces SUPER_ADMIN on every
  // route, so nothing here is reachable by org admins or players.
  app.use('/api/admin', createAdminRouter());

  app.use('/api', createGameRouter(repos, orchestrator));
  app.use('/api', createPuzzleBankRouter(repos));
  app.use('/api', createParticipantRouter(repos));
  app.use('/api', createMonitoringRouter(repos, state));

  // Setup WebSocket via SocketManager (replaces socketHandler)
  new SocketManager(io, repos, orchestrator, bus, presenceService, displayManager);

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

  // Last-resort error handler. Express 4 does not catch rejections thrown by
  // async route handlers, so any handler that awaits without a try/catch
  // produces an unhandled rejection — which, since Node 15, terminates the
  // process. One failing request would take the whole server down: a bad
  // DELETE really did kill it. Handlers that call next(err) land here; the
  // guard below covers the rest.
  app.use((err, req, res, next) => {
    logger.error('API request failed', {
      method: req.method,
      path: req.path,
      error: err.message,
    });
    if (res.headersSent) return next(err);

    // Multer errors: bad extension (a plain Error from fileFilter) and
    // "file too large" (MulterError code LIMIT_FILE_SIZE) reach here too.
    // Return an actionable message with a specific code — clients keyed
    // off the code (e.g. the upload UI) can surface a real reason instead
    // of "服务器内部错误". Multer sets `err.name === 'MulterError'` on
    // size/count/field errors; the fileFilter throw is a plain Error whose
    // message we forward verbatim (already localized).
    if (err && err.name === 'MulterError') {
      const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        code: isTooLarge ? 40010 : 40011,
        message: isTooLarge ? '文件过大（最大 10 MB）' : `文件上传失败：${err.message}`,
        data: null,
      });
    }
    // fileFilter rejection surfaces as a plain Error with our own message.
    // Detect by presence of an req.file expectation on an upload route.
    if (err && typeof err.message === 'string' && err.message.startsWith('仅支持')) {
      return res.status(400).json({ code: 40011, message: err.message, data: null });
    }

    res.status(500).json({ code: 50000, message: '服务器内部错误', data: null });
  });

  process.on('unhandledRejection', (reason) => {
    // Log and keep serving. Crashing on one bad request is worse than
    // answering the next one.
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  const PORT = config.PORT;
  server.listen(PORT, () => {
    logger.info('Server listening', { port: PORT, url: `http://localhost:${PORT}` });
  });
}

main().catch(err => {
  logger.fatal('Failed to start server', { error: err.message });
});
