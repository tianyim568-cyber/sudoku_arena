# Sudoku Arena — Backend Documentation

**Document Version:** 2.
**Last Updated:** 2026-08-23

> **IMPORTANT — August 2026 architecture overhaul.** The body of this document was written 2026-07-24 and describes a monolithic architecture that has since been heavily refactored. The section below summarizes the major changes. When the body below contradicts the August 2026 update, **trust the August 2026 update**. A full rewrite is tracked as a follow-up; until then, the update section is the source of truth.

## August 2026 Updates (since v1.0 / 2026-07-24)

### 1. Routes — `tournaments.js` → `competitions.js` + 8 specialized routers

The old monolithic `routes/tournaments.js` no longer exists. The CRUD moved to `routes/competitions.js` (mounted at `/api/competitions`), and 8 specialized routers were carved out:

- `routes/competitions.js` — CRUD + publish + access-link generation (`buildEntryUrl`)
- `routes/competitionSetup.js` — stages, rounds, puzzle assignment
- `routes/access-links.js` — competition entry links (POST, GET, DELETE, GET /by-code/:accessCode/info)
- `routes/display.js` — display token + ranking snapshot + broadcast
- `routes/monitoring.js` — judge monitoring endpoints
- `routes/game.js` — live game orchestration (start, pause, resume, end)
- `routes/participants.js` — Excel import + confirm flow
- `routes/puzzleBank.js` — puzzle generation + import
- `routes/admin.js` — super-admin platform stats
- `routes/auth.js` — login + JWT issuance (extended)

### 2. Database — Prisma replaced raw `pg`

- `server/src/db/prisma.js` — Prisma client singleton
- `server/src/db/connection.js` — still present but refactored
- Schema managed by Prisma migrations (not manual `utils/db.js` seeds)
- 14 repositories in `server/src/db/` (was 9): added `CategoryRepository`, `OrganizationRepository`, `ParticipantRepository`, `RankingRepository`
- All repositories now use Prisma models, not raw SQL pools

### 3. Engine — stratified Game → Stage → Round

The old flat `GameOrchestrator + Round1/2/3Engine` was reorganized into a layered model:

- `engine/GameOrchestrator.js` — top-level competition lifecycle (start, pause, end)
- `engine/StageManager.js` — multi-stage orchestration (INDIVIDUAL + TEAM)
- `engine/RoundManager.js` — per-round lifecycle (start, tick, end, auto-progress)
- `engine/DisplayManager.js` (**new**) — display tokens, ranking snapshots, mode switching, player broadcast
- `engine/EmissionBus.js` — central event emitter (targeted: display / judge / player rooms)
- `engine/MonitoringService.js` (**new**) — per-player monitoring detail fetch
- `engine/RoomService.js` — room state

### 4. Middleware — 6 middlewares (was 1)

- `middleware/auth.js` — extended to support 2 JWT types: org-scoped (username/password login) + competition-scoped (access-code login via `competitionLogin`)
- `middleware/rateLimiters.js` (**new**) — `authLimiter` (login brute-force) + `expensiveLimiter` (puzzle generation, file upload)
- `middleware/fileType.js` (**new**) — magic-bytes MIME validation (not just extension)
- `middleware/validate.js` (**new**) — Zod schema validation
- `middleware/tenantGuard.js` (**new**) — cross-tenant access prevention (org_id check)
- `middleware/competitionAuth.js` (**new**) — competition entry token verification

### 5. Logging — Pino logger implemented

The v1.0 doc said "recommended: winston or pino" as a future improvement. It is now in place:

- `server/src/utils/logger.js` — Pino-based logger
- JSON format in production, pretty-print in dev
- Secret sanitization (defense-in-depth — JWT, passwords, tokens scrubbed)
- Level configurable via `LOG_LEVEL` env var

### 6. Tests — 20+ test files (was "no automated tests")

The v1.0 doc said "No automated tests in the backend codebase." This is no longer true. `server/src/__tests__/` contains 20+ test files:

- `GameOrchestrator-*.test.js` — lifecycle, team-stage (note: ISSUE-033 preexisting failures)
- `routes-*.test.js` — access-links, competition-lifecycle, publish, competitions, competitionSetup, game, auth
- `middleware-*.test.js` — validate, rateLimiters, fileType
- `monitoring.test.js`, `display.test.js`, `routes-tournaments.test.js` (legacy name, tests competitions)
- Jest + Supertest for API integration tests
- Prisma is mocked in unit tests; real DB used in `louise/test-*.js` E2E scripts

### 7. Display modes — 6 modes (was 3)

`DisplayModes.js` now defines: `DEFAULT`, `LIVE_RANKING`, `PLAYER_BROADCAST`, `ROUND_RANKING`, `STAGE_RANKING`, `FINAL_RANKING`. The server emits `RANKING_UPDATE`, `DISPLAY_MODE_CHANGED`, `DISPLAY_PLAYER_BROADCAST`, `DISPLAY_TOKEN_REVOKED` to the display room via `EmissionBus`.

### 8. Competition entry — public access-link flow

New public flow for players/judges joining a competition:
- Admin generates an access link (`POST /api/competitions/:id/access-link`)
- Link carries an `accessCode` (not a JWT)
- Landing page `GET /api/competitions/by-code/:accessCode/info` is public (no auth)
- Login: `POST /api/competitions/by-code/:identifier/login` issues a competition-scoped JWT

### 9. Security hardening

- Tenant guard on all competition routes (org_id check)
- Rate limiting on auth + expensive endpoints
- File type validation via magic bytes
- Zod request validation on all mutation routes
- No stack traces in error responses in production

See `louise/JOURNAL_MODIFICATIONS.md` for the full change history, and `louise/KNOWN_ISSUES.md` for open issues.

---

## Overview

This document provides a comprehensive guide to the Sudoku Arena backend codebase, designed for junior backend developers. The server is a Node.js/Express application with real-time WebSocket communication, PostgreSQL persistence, and optional Redis caching.

**Target Audience:** Junior backend developers joining the project or contributing to server-side features.

**Prerequisites:** Basic Node.js/Express knowledge, understanding of REST APIs, familiarity with SQL databases, basic WebSocket concepts.

---

## Project Setup

### Technology Stack

- **Runtime:** Node.js 20+ (LTS)
- **Framework:** Express.js 4
- **Real-time:** Socket.IO 4 (WebSocket + fallback)
- **Database:** PostgreSQL 12+ (pg driver with connection pooling)
- **Cache:** Redis 6+ (optional, ioredis client)
- **Authentication:** JWT (jsonwebtoken) + bcrypt password hashing
- **Rate Limiting:** express-rate-limit

### Development Environment

**Prerequisites:**
- Node.js 20+
- PostgreSQL 12+ (or Docker)
- Redis 6+ (optional, or Docker)

**Installation:**

```bash
cd server
npm install
```

**Database Setup:**

```bash
# Create database
createdb sudoku_arena

# Or with Docker
docker run --name sudoku-postgres -e POSTGRES_DB=sudoku_arena -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres:12
```

**Start Development Server:**

```bash
npm run dev
```

Server runs on `http://localhost:3001` with auto-reload (nodemon).

**Environment Variables:**

Create `.env` file:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/sudoku_arena
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-change-in-production
PORT=3001
```

---

## Application Structure

### Directory Layout

```
server/
├── src/
│   ├── config.js              # Centralized configuration
│   ├── index.js               # Entry point (Express + Socket.IO setup)
│   ├── db/                    # Database layer
│   │   ├── connection.js      # PostgreSQL pool + query helper
│   │   ├── index.js           # Repository factory (9 repositories)
│   │   └── repositories/      # Repository classes
│   │       ├── UserRepository.js
│   │       ├── TournamentRepository.js
│   │       ├── RoundRepository.js
│   │       ├── PuzzleRepository.js
│   │       ├── TeamRepository.js
│   │       ├── SubmissionRepository.js
│   │       ├── ScoreRepository.js
│   │       ├── PlayerStateRepository.js
│   │       └── TeamPuzzleSetRepository.js
│   ├── engine/                # Game logic
│   │   ├── GameOrchestrator.js # Top-level coordinator
│   │   ├── RoundEngine.js     # Abstract base class
│   │   ├── Round1Engine.js    # Nine-One round logic
│   │   ├── Round2Engine.js    # Relay round logic
│   │   ├── Round3Engine.js    # Collaboration round logic
│   │   ├── ScoringService.js  # Score calculations
│   │   ├── TimerService.js    # Server-authoritative timer
│   │   └── errors.js          # Custom error classes
│   ├── middleware/            # Express middleware
│   │   └── auth.js            # JWT authentication + RBAC
│   ├── routes/                # API routes
│   │   ├── auth.js            # Login endpoint
│   │   ├── tournaments.js     # Tournament CRUD
│   │   ├── game.js            # Game lifecycle + my-state
│   │   ├── users.js           # User management (admin)
│   │   └── puzzleBank.js      # Puzzle bank operations
│   ├── services/              # Business logic services
│   │   ├── PuzzleAssignmentService.js
│   │   ├── PuzzleBankService.js
│   │   ├── Round2NotificationService.js
│   │   └── Round3CollaborationService.js
│   ├── state/                 # Ephemeral state layer
│   │   ├── StateRepository.js # Abstract interface
│   │   ├── MemoryStateRepository.js
│   │   ├── RedisStateRepository.js
│   │   └── index.js           # Factory (Redis or Memory)
│   ├── utils/                 # Utilities
│   │   ├── db.js              # Database schema + seeds
│   │   └── sudokuGenerator.js # Puzzle generation algorithm
│   ├── ws/                    # WebSocket layer
│   │   ├── EmissionBus.js     # Event dispatcher
│   │   └── SocketManager.js   # Socket.IO transport
│   └── data/                  # Static data
│       └── words.json         # 9-letter word list (100 words)
├── data/
│   └── puzzle-bank.json       # Pre-generated puzzle pool
├── package.json
└── .env
```

### Key Architectural Decisions

**1. Repository Pattern:**
All database access is abstracted through repository classes. This decouples business logic from SQL and enables testing with mock repositories.

**2. Strategy Pattern (Round Engines):**
Each round type has its own engine class extending `RoundEngine` base. This allows polymorphic dispatch without conditional branching.

**3. Emission Pattern:**
RoundEngines return **emission objects** instead of calling Socket.IO directly. This keeps engines transport-agnostic and testable.

**4. State Repository Abstraction:**
Ephemeral state (timers, R2 assignments, R3 proposals) is managed through `StateRepository` interface with two implementations (Memory and Redis).

---

## Entry Point & Server Initialization

### index.js

**Location:** `src/index.js`

**Responsibilities:**
1. Initialize Express app with middleware
2. Create HTTP server
3. Initialize Socket.IO with CORS
4. Connect to PostgreSQL (run schema + seeds)
5. Instantiate repositories
6. Create GameOrchestrator
7. Mount API routes
8. Start listening

**Initialization Flow:**

```javascript
// 1. Load config
const config = require('./config');

// 2. Create Express app
const app = express();
app.use(express.json());
app.use(cors({ origin: config.corsOrigin }));

// 3. Create HTTP server
const server = http.createServer(app);

// 4. Initialize Socket.IO
const io = new Server(server, {
  cors: { origin: config.corsOrigin }
});

// 5. Connect to database
const db = require('./db/connection')(config.databaseUrl);
await db.initialize(); // Run schema + seeds

// 6. Instantiate repositories
const repos = require('./db')(db);

// 7. Create state repository
const stateRepo = require('./state')(config.redisUrl);

// 8. Create emission bus + socket manager
const emissionBus = new EmissionBus();
const socketManager = new SocketManager(io, emissionBus);

// 9. Create game orchestrator
const orchestrator = new GameOrchestrator(repos, stateRepo, emissionBus);

// 10. Mount routes
app.use('/api/auth', require('./routes/auth')(repos));
app.use('/api/tournaments', require('./routes/tournaments')(repos, orchestrator));
app.use('/api/game', require('./routes/game')(repos, orchestrator));

// 11. Setup WebSocket
socketManager.setup(orchestrator);

// 12. Start server
server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
```

---

## Configuration

### config.js

**Location:** `src/config.js`

**Purpose:** Centralized configuration from environment variables.

```javascript
module.exports = {
  port: process.env.PORT || 3001,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/sudoku_arena',
  redisUrl: process.env.REDIS_URL || null,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '24h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    max: 100 // requests per window
  }
};
```

**Usage:**

```javascript
const config = require('./config');
console.log('Port:', config.port);
console.log('Database:', config.databaseUrl);
```

---

## Database Layer

### Connection Management

**Location:** `src/db/connection.js`

**PostgreSQL Pool:**

```javascript
const { Pool } = require('pg');

function createConnection(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    // Execute query with parameter conversion (? → $1, $2, ...)
    async query(sql, params = []) {
      const converted = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const result = await pool.query(converted, params);
      return result.rows;
    },

    // Get single row
    async get(sql, params = []) {
      const rows = await this.query(sql, params);
      return rows[0] || null;
    },

    // Get all rows
    async all(sql, params = []) {
      return this.query(sql, params);
    },

    // Execute statement (INSERT/UPDATE/DELETE)
    async run(sql, params = []) {
      const converted = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const result = await pool.query(converted, params);
      return { changes: result.rowCount };
    },

    // Initialize schema + seeds
    async initialize() {
      const schema = require('../utils/db');
      await pool.query(schema.createTables);
      await pool.query(schema.seedData);
    }
  };
}
```

**Key Features:**
- Connection pooling (default 10 connections)
- Parameter conversion (`?` → `$1, $2, ...` for PostgreSQL)
- Automatic schema initialization on startup

---

### Database Schema

**Location:** `src/utils/db.js`

**Tables (11 total):**

#### users

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'JUDGE', 'PLAYER')),
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### tournaments

```sql
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'PAUSED', 'FINISHED')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### rounds

```sql
CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  name VARCHAR(100),
  round_type VARCHAR(50) NOT NULL CHECK (round_type IN ('ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE')),
  duration_seconds INTEGER,
  status VARCHAR(20) DEFAULT 'NOT_STARTED',
  turn_ends_at BIGINT,
  remaining_at_pause INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tournament_id, round_number)
);
```

#### puzzles

```sql
CREATE TABLE IF NOT EXISTS puzzles (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  puzzle_type VARCHAR(20),
  difficulty VARCHAR(20),
  initial_grid JSON NOT NULL,
  solution JSON NOT NULL,
  letter VARCHAR(1),
  points INTEGER DEFAULT 10,
  order_in_round INTEGER,
  team_id INTEGER REFERENCES teams(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### teams

```sql
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### team_members

```sql
CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER,
  PRIMARY KEY (team_id, player_id)
);
```

#### tournament_judges

```sql
CREATE TABLE IF NOT EXISTS tournament_judges (
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  judge_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, judge_id)
);
```

#### player_puzzle_assignments

```sql
CREATE TABLE IF NOT EXISTS player_puzzle_assignments (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  current_grid JSON,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### submissions

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  submission_type VARCHAR(50),
  submitted_value JSON,
  is_correct BOOLEAN,
  points_earned INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### scores

```sql
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  score_type VARCHAR(20) CHECK (score_type IN ('TEAM', 'INDIVIDUAL')),
  total_points INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tournament_id, round_id, team_id, player_id, score_type)
);
```

#### team_puzzle_sets

```sql
CREATE TABLE IF NOT EXISTS team_puzzle_sets (
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  word VARCHAR(9),
  puzzle_ids TEXT,
  PRIMARY KEY (round_id, team_id)
);
```

---

### Repository Pattern

**Location:** `src/db/repositories/`

**Purpose:** Abstract SQL queries into reusable methods.

**Example: UserRepository**

```javascript
class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  async findByUsername(username) {
    return this.db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findByUsernameSafe(username) {
    return this.db.get('SELECT id, username, role, display_name FROM users WHERE username = ?', [username]);
  }

  async findAll() {
    return this.db.all('SELECT id, username, role, display_name FROM users');
  }

  async findByRole(role) {
    return this.db.all('SELECT id, username, role, display_name FROM users WHERE role = ?', [role]);
  }

  async create({ username, password, role, displayName }) {
    await this.db.run(
      'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)',
      [username, password, role, displayName]
    );
    return this.db.get('SELECT * FROM users ORDER BY id DESC LIMIT 1');
  }
}
```

**Usage:**

```javascript
const user = await repos.users.findByUsername('admin');
if (!user) return null;

const valid = bcrypt.compareSync(password, user.password_hash);
if (!valid) return null;

return user;
```

**Repository List:**

| Repository | Purpose |
|------------|---------|
| `UserRepository` | User CRUD, authentication queries |
| `TournamentRepository` | Tournament lifecycle, cascade delete |
| `RoundRepository` | Round CRUD, status updates |
| `PuzzleRepository` | Puzzle CRUD, letter updates |
| `TeamRepository` | Team CRUD, member management |
| `SubmissionRepository` | Submission logging, solved puzzle queries |
| `ScoreRepository` | Score upsert, aggregation |
| `PlayerStateRepository` | Player assignments, round states |
| `TeamPuzzleSetRepository` | Team puzzle set persistence |

**Dependency Injection:**

Repositories are instantiated in `src/db/index.js`:

```javascript
function createRepositories(db) {
  return {
    users: new UserRepository(db),
    tournaments: new TournamentRepository(db),
    rounds: new RoundRepository(db),
    puzzles: new PuzzleRepository(db),
    teams: new TeamRepository(db),
    submissions: new SubmissionRepository(db),
    scores: new ScoreRepository(db),
    playerState: new PlayerStateRepository(db),
    teamPuzzleSets: new TeamPuzzleSetRepository(db)
  };
}
```

Injected into routes and services via factory functions.

---

## Authentication & Authorization

### JWT Flow

**Location:** `src/middleware/auth.js`

**Token Generation:**

```javascript
const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
```

**Authentication Middleware:**

```javascript
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 40100, message: '未授权' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { userId, role }
    next();
  } catch (err) {
    return res.status(401).json({ code: 40100, message: '令牌无效或已过期' });
  }
}
```

**Role-Based Access Control (RBAC):**

```javascript
function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 40100, message: '未授权' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ code: 40300, message: '权限不足' });
    }
    next();
  };
}
```

**Usage in Routes:**

```javascript
// Public route (no auth)
router.post('/login', loginHandler);

// Protected route (any authenticated user)
router.get('/', authMiddleware, listHandler);

// Admin-only route
router.post('/', authMiddleware, roleMiddleware('ADMIN'), createHandler);

// Judge or Admin
router.post('/start', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), startHandler);
```

---

### Login Endpoint

**Location:** `src/routes/auth.js`

```javascript
router.post('/login', rateLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ code: 40000, message: '缺少用户名或密码', data: null });
  }

  const user = await repos.users.findByUsername(username);
  if (!user) {
    return res.json({ code: 40100, message: '用户名或密码错误', data: null });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.json({ code: 40100, message: '用户名或密码错误', data: null });
  }

  const token = signToken({ userId: user.id, role: user.role });

  res.json({
    code: 200,
    message: 'success',
    data: {
      token: `Bearer ${token}`,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name
      }
    }
  });
});
```

**Rate Limiting:**

```javascript
const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute
  message: { code: 42900, message: '登录尝试过多，请稍后再试' }
});
```

---

## API Routes

### Tournaments

**Location:** `src/routes/tournaments.js`

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tournaments` | Any | List all tournaments |
| GET | `/api/tournaments/:id` | Any | Get tournament details |
| POST | `/api/tournaments` | ADMIN | Create tournament |
| DELETE | `/api/tournaments/:id` | ADMIN | Delete tournament |
| POST | `/api/tournaments/:id/start` | JUDGE/ADMIN | Start tournament |
| POST | `/api/tournaments/:id/pause` | JUDGE/ADMIN | Pause tournament |
| POST | `/api/tournaments/:id/resume` | JUDGE/ADMIN | Resume tournament |
| POST | `/api/tournaments/:id/end` | JUDGE/ADMIN | End tournament |

**Example: Create Tournament**

```javascript
router.post('/', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.json({ code: 40000, message: '缺少赛事名称', data: null });
  }

  const tournament = await repos.tournaments.create({
    name,
    createdBy: req.user.userId
  });

  res.json({ code: 200, message: 'success', data: tournament });
});
```

---

### Game

**Location:** `src/routes/game.js`

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/game/:tournamentId/my-state` | PLAYER | Get player's current game state |
| POST | `/api/game/:tournamentId/rounds/:roundId/start` | JUDGE/ADMIN | Start round |
| POST | `/api/game/:tournamentId/rounds/:roundId/end` | JUDGE/ADMIN | End round |
| POST | `/api/game/:tournamentId/rounds/:roundId/submit-answer` | PLAYER | Submit puzzle answer |

**Example: Get My Game State**

```javascript
router.get('/:tournamentId/my-state', authMiddleware, roleMiddleware('PLAYER'), async (req, res) => {
  const { tournamentId } = req.params;
  const userId = req.user.userId;

  // Find player's team
  const team = await repos.teams.findMemberTeam(tournamentId, userId);
  if (!team) {
    return res.json({ code: 40400, message: '未分配到队伍', data: null });
  }

  // Find current round
  const currentRound = await repos.rounds.findActiveRound(tournamentId);
  if (!currentRound) {
    return res.json({ code: 200, message: 'success', data: { currentRound: null } });
  }

  // Get round-specific state
  let roundState = {};
  if (currentRound.round_type === 'ROUND1_NINE_ONE') {
    roundState = await getRound1State(repos, currentRound.id, team.id);
  } else if (currentRound.round_type === 'ROUND2_RELAY') {
    roundState = await getRound2State(repos, stateRepo, currentRound.id, team.id, userId);
  } else if (currentRound.round_type === 'ROUND3_COLLABORATE') {
    roundState = await getRound3State(repos, stateRepo, currentRound.id, team.id);
  }

  res.json({
    code: 200,
    message: 'success',
    data: {
      currentRound,
      team,
      ...roundState
    }
  });
});
```

---

### Puzzle Bank

**Location:** `src/routes/puzzleBank.js`

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/puzzle-bank` | Any | List puzzles (with filters) |
| GET | `/api/puzzle-bank/:id` | ADMIN/JUDGE | Get puzzle detail |
| GET | `/api/puzzle-bank/:id/preview` | ADMIN/JUDGE | Preview puzzle grid |
| POST | `/api/puzzle-bank/generate` | ADMIN | Generate puzzles |
| POST | `/api/puzzle-bank/generate-bulk` | ADMIN | Bulk generate all rounds |
| POST | `/api/puzzle-bank/import-to-round` | ADMIN | Import to round |
| DELETE | `/api/puzzle-bank/:id` | ADMIN | Delete puzzle |
| DELETE | `/api/puzzle-bank` | ADMIN | Clear all puzzles |

**Example: Generate Puzzles**

```javascript
router.post('/generate', authMiddleware, roleMiddleware('ADMIN'), (req, res) => {
  const { roundType, teamsCount } = req.body;
  if (!roundType) {
    return res.json({ code: 40010, message: '缺少轮次类型', data: null });
  }

  const data = puzzleBankService.generatePuzzles({ roundType, teamsCount });
  res.json({ code: 200, message: 'success', data });
});
```

---

## Game Orchestration

### GameOrchestrator

**Location:** `src/engine/GameOrchestrator.js`

**Purpose:** Top-level coordinator for game lifecycle. Holds NO in-memory state — delegates to repositories and engines.

**Key Methods:**

```javascript
class GameOrchestrator {
  constructor(repos, stateRepo, emissionBus) {
    this.repos = repos;
    this.stateRepo = stateRepo;
    this.emissionBus = emissionBus;
  }

  async startTournament(tournamentId) {
    await this.repos.tournaments.updateStatus(tournamentId, 'IN_PROGRESS');
    this.emissionBus.emit({
      target: 'tournament',
      targetId: tournamentId,
      event: 'TOURNAMENT_STARTED',
      payload: { tournamentId }
    });
  }

  async startRound(tournamentId, roundId) {
    const round = await this.repos.rounds.findById(roundId);
    if (!round) throw new Error('Round not found');

    // Create engine based on round type
    let engine;
    if (round.round_type === 'ROUND1_NINE_ONE') {
      engine = new Round1Engine(this.repos, this.stateRepo, round);
    } else if (round.round_type === 'ROUND2_RELAY') {
      engine = new Round2Engine(this.repos, this.stateRepo, round);
    } else if (round.round_type === 'ROUND3_COLLABORATE') {
      engine = new Round3Engine(this.repos, this.stateRepo, round);
    }

    // Start round
    const emissions = await engine.start();
    this.emissionBus.emitAll(emissions);

    // Update round status
    await this.repos.rounds.updateStatus(roundId, 'IN_PROGRESS');
  }

  async submitAnswer(tournamentId, roundId, userId, puzzleId, submissionType, data) {
    const round = await this.repos.rounds.findById(roundId);
    const engine = this.createEngine(round);
    const emissions = await engine.submitAnswer(userId, puzzleId, submissionType, data);
    this.emissionBus.emitAll(emissions);
  }
}
```

**Design Principles:**
- **Stateless:** All state comes from repositories or state repository.
- **Delegation:** Routes commands to appropriate RoundEngine.
- **Emission Processing:** Collects emissions from engines and dispatches via EmissionBus.

---

## Round Engines

### RoundEngine (Base Class)

**Location:** `src/engine/RoundEngine.js`

**Purpose:** Abstract base class defining interface for all round engines.

```javascript
class RoundEngine {
  constructor(repos, stateRepo, round) {
    this.repos = repos;
    this.stateRepo = stateRepo;
    this.round = round;
  }

  // Abstract methods (must be implemented by subclasses)
  async start() { throw new Error('Not implemented'); }
  async submitAnswer(userId, puzzleId, submissionType, data) { throw new Error('Not implemented'); }
  async end() { throw new Error('Not implemented'); }
}
```

---

### Round1Engine (Nine-One)

**Location:** `src/engine/Round1Engine.js`

**Game Logic:**

1. **Start:**
   - Assign 9 JOC puzzles + 1 FINAL puzzle per team
   - Assign 9-letter word (from `words.json`)
   - Emit `ROUND_STARTED` with puzzle list

2. **Submit Answer:**
   - **JOC (Single Cell):**
     - Validate cell is empty in initial grid
     - Check if value matches solution
     - If correct: mark puzzle solved, reveal letter, check if all JOC solved → unlock FINAL
     - Emit `PUZZLE_SOLVED` or `ANSWER_RESULT`
   - **FINAL (Full Grid):**
     - Validate all cells match solution
     - If correct: mark solved, calculate time bonus
     - Emit `PUZZLE_SOLVED` with score

3. **End:**
   - Calculate final scores
   - Emit `ROUND_FINISHED`

**Key Methods:**

```javascript
async submitAnswer(userId, puzzleId, submissionType, data) {
  const emissions = [];

  // Find player's team
  const team = await this.repos.teams.findMemberTeam(this.round.tournament_id, userId);
  if (!team) throw new Error('Player not in team');

  // Check if puzzle already solved
  const solved = await this.repos.submissions.findTeamSolvedPuzzle(this.round.id, team.id, puzzleId);
  if (solved) {
    return [{
      target: 'user',
      targetId: userId,
      event: 'ANSWER_RESULT',
      payload: { isCorrect: false, message: '这道题已被你的队伍解答' }
    }];
  }

  const puzzle = await this.repos.puzzles.findById(puzzleId);

  if (submissionType === 'SINGLE_CELL') {
    const { row, col, value } = data;
    const isCorrect = puzzle.solution[row][col] === value;

    if (isCorrect) {
      // Log submission
      await this.repos.submissions.create({
        roundId: this.round.id,
        playerId: userId,
        puzzleId,
        teamId: team.id,
        submissionType: 'SINGLE_CELL',
        submittedValue: JSON.stringify({ row, col, value }),
        isCorrect: true,
        pointsEarned: puzzle.points
      });

      // Update score
      await this.repos.scores.addTeamPoints(this.round.tournament_id, this.round.id, team.id, puzzle.points);

      // Reveal letter
      await this.repos.puzzles.updateLetter(puzzleId, puzzle.letter);

      // Check if all JOC solved → unlock FINAL
      const jocSolved = await this.repos.submissions.findTeamJocCorrect(this.round.id, team.id);
      if (jocSolved.length === 9) {
        emissions.push({
          target: 'team',
          targetId: team.id,
          event: 'FINAL_UNLOCKED',
          payload: {}
        });
      }

      emissions.push({
        target: 'team',
        targetId: team.id,
        event: 'PUZZLE_SOLVED',
        payload: { puzzleId, pointsEarned: puzzle.points }
      });
    } else {
      emissions.push({
        target: 'user',
        targetId: userId,
        event: 'ANSWER_RESULT',
        payload: { isCorrect: false, message: '答案错误' }
      });
    }
  }

  return emissions;
}
```

---

### Round2Engine (Relay)

**Location:** `src/engine/Round2Engine.js`

**Game Logic:**

1. **Start:**
   - Assign 16 puzzles per team (8E+6M+2H)
   - Assign 1 puzzle per player (4 players per team)
   - Start 60-second rotation timer
   - Schedule rotation warnings (5s before rotation)
   - Emit `ROUND_STARTED` with assigned puzzles

2. **Submit Answer:**
   - Validate puzzle is assigned to player
   - Check if correct (single cell or full grid)
   - If correct: mark solved, acquire next available puzzle, assign to player
   - Emit `PUZZLE_SOLVED`, `PUZZLE_ASSIGNED`

3. **Rotate Puzzles:**
   - Every 60 seconds, rotate puzzles to next player
   - Use atomic `acquireRound2Puzzle()` to prevent race conditions
   - Emit `ROTATION_WARNING` (5s before), `ROUND2_ROTATED`

4. **End:**
   - Calculate completion bonus (if all 16 solved)
   - Emit `ROUND_FINISHED`

**Race Condition Prevention:**

```javascript
async submitAnswer(userId, puzzleId, submissionType, data) {
  // ... validation ...

  if (isCorrect) {
    // Mark current puzzle solved
    await this.repos.playerState.markTeamAssignmentsCompleted(this.round.id, puzzleId, team.id);

    // Find next available puzzle
    const assignedIds = await this.repos.playerState.findAssignedPuzzleIds(this.round.id, team.id);
    const allPuzzles = await this.repos.puzzles.findByRoundAndTeam(this.round.id, team.id);
    const available = allPuzzles.filter(p => !assignedIds.includes(p.id) && !p.is_completed);

    if (available.length > 0) {
      // Shuffle and try to acquire
      const shuffled = available.sort(() => Math.random() - 0.5);
      let acquired = null;

      for (const candidate of shuffled) {
        const success = await this.stateRepo.acquireRound2Puzzle(
          this.round.id, team.id, userId, candidate.id
        );
        if (success) {
          acquired = candidate;
          break;
        }
      }

      if (acquired) {
        // Create assignment
        await this.repos.playerState.createAssignment({
          roundId: this.round.id,
          playerId: userId,
          puzzleId: acquired.id,
          teamId: team.id,
          currentGrid: JSON.stringify(acquired.initial_grid),
          isCompleted: false
        });

        emissions.push({
          target: 'user',
          targetId: userId,
          event: 'PUZZLE_ASSIGNED',
          payload: { puzzle: acquired }
        });
      }
    }
  }

  return emissions;
}
```

---

### Round3Engine (Collaborate)

**Location:** `src/engine/Round3Engine.js`

**Game Logic:**

1. **Start:**
   - Select 10 puzzles (5E+3M+2H) for round
   - All teams solve same puzzles
   - Emit `ROUND_STARTED`

2. **Propose Cell:**
   - Player proposes cell value (row, col, value)
   - Store in state repository (suggestions map)
   - Emit `ROUND3_PROPOSAL` to team

3. **Accept/Reject Proposal:**
   - **Accept:** Record vote, check if all online teammates approved
     - If unanimous: atomically claim cell, update grid, emit `ROUND3_CELL_FILLED`
   - **Reject:** Immediately kill proposal, emit `ROUND3_PROPOSAL_REJECTED`

4. **End:**
   - Calculate completion bonus
   - Emit `ROUND_FINISHED`

**Consensus Model:**

```javascript
async acceptProposal(tournamentId, roundId, puzzleId, row, col, userId) {
  const emissions = [];

  // Get suggestion
  const suggestion = await this.stateRepo.getRound3Suggestion(puzzleId, row, col);
  if (!suggestion) throw new Error('Proposal not found');

  // Proposer can't approve own proposal
  if (suggestion.proposerId === userId) {
    throw new Error('Cannot approve your own proposal');
  }

  // Record vote
  await this.stateRepo.addRound3Vote(puzzleId, row, col, userId);

  // Get all votes
  const votes = await this.stateRepo.getRound3Votes(puzzleId, row, col);

  // Get online teammates
  const team = await this.repos.teams.findMemberTeam(tournamentId, userId);
  const onlinePlayers = await this.stateRepo.getActivePlayers(tournamentId);
  const onlineTeammates = onlinePlayers.filter(p => p.teamId === team.id && p.userId !== suggestion.proposerId);

  // Check if all online teammates approved
  if (votes.length >= onlineTeammates.length) {
    // Unanimous! Claim cell atomically
    const claimed = await this.stateRepo.claimRound3Cell(puzzleId, row, col, suggestion.value);
    if (claimed) {
      // Update grid
      await this.stateRepo.setRound3Cell(puzzleId, row, col, suggestion.value);

      // Remove suggestion
      await this.stateRepo.removeRound3Suggestion(puzzleId, row, col);

      emissions.push({
        target: 'team',
        targetId: team.id,
        event: 'ROUND3_CELL_FILLED',
        payload: { puzzleId, row, col, value: suggestion.value }
      });
    }
  } else {
    emissions.push({
      target: 'team',
      targetId: team.id,
      event: 'ROUND3_VOTE',
      payload: { puzzleId, row, col, votes: votes.length }
    });
  }

  return emissions;
}
```

---

## State Management

### StateRepository Interface

**Location:** `src/state/StateRepository.js`

**Purpose:** Abstract interface for ephemeral state (timers, R2 assignments, R3 proposals).

**Methods:**

```javascript
class StateRepository {
  // Round Timers
  async setRoundTimer(roundId, turnEndsAt, durationSeconds) {}
  async getRoundTimer(roundId) {}
  async deleteRoundTimer(roundId) {}
  async getRemainingSeconds(roundId) {}

  // Round 2 Team State
  async setRound2TeamState(roundId, teamId, state) {}
  async getRound2TeamState(roundId, teamId) {}
  async deleteRound2TeamState(roundId, teamId) {}
  async updateRound2Grid(roundId, teamId, puzzleId, grid) {}
  async setPlayerPuzzle(roundId, teamId, userId, puzzleId) {}
  async deletePlayerPuzzle(roundId, teamId, userId) {}
  async acquireRound2Puzzle(roundId, teamId, userId, puzzleId) {}
  async releaseRound2Puzzle(roundId, teamId, userId) {}
  async getAssignedPuzzle(roundId, teamId, userId) {}

  // Round 3 Cells
  async getRound3Cells(puzzleId) {}
  async setRound3Cell(puzzleId, row, col, value) {}
  async deleteRound3Cells(puzzleId) {}
  async claimRound3Cell(puzzleId, row, col, value) {}

  // Round 3 Suggestions
  async getRound3Suggestion(puzzleId, row, col) {}
  async addRound3Suggestion(puzzleId, row, col, value, proposerId) {}
  async removeRound3Suggestion(puzzleId, row, col) {}
  async deleteRound3Suggestions(puzzleId) {}

  // Round 3 Votes
  async addRound3Vote(puzzleId, row, col, userId) {}
  async getRound3Votes(puzzleId, row, col) {}
  async deleteRound3Votes(puzzleId, row, col) {}

  // Round 3 Focus
  async setRound3Focus(puzzleId, userId, row, col) {}
  async getRound3Focus(puzzleId) {}
  async deleteRound3Focus(puzzleId) {}

  // Active Players
  async setActivePlayers(tournamentId, players) {}
  async removeActivePlayer(tournamentId, userId) {}
  async getActivePlayers(tournamentId) {}
}
```

---

### MemoryStateRepository

**Location:** `src/state/MemoryStateRepository.js`

**Implementation:** In-memory Maps (single-instance deployments).

```javascript
class MemoryStateRepository extends StateRepository {
  constructor() {
    super();
    this._timers = new Map();
    this._r2Teams = new Map();
    this._r3Cells = new Map();
    this._r3Suggestions = new Map();
    this._r3Votes = new Map();
    this._r3Focuses = new Map();
    this._activePlayers = new Map();
  }

  async acquireRound2Puzzle(roundId, teamId, userId, puzzleId) {
    const key = `${roundId}:${teamId}`;
    const teamState = this._r2Teams.get(key) || { assignments: {} };

    // Check if puzzle already assigned
    const allAssignments = Object.values(teamState.assignments);
    if (allAssignments.includes(puzzleId)) {
      return false; // Already taken
    }

    // Atomic set
    teamState.assignments[userId] = puzzleId;
    this._r2Teams.set(key, teamState);
    return true;
  }

  async claimRound3Cell(puzzleId, row, col, value) {
    const key = `${puzzleId}`;
    const cells = this._r3Cells.get(key) || {};
    const cellKey = `${row},${col}`;

    if (cells[cellKey] !== undefined) {
      return false; // Already claimed
    }

    cells[cellKey] = value;
    this._r3Cells.set(key, cells);
    return true;
  }
}
```

---

### RedisStateRepository

**Location:** `src/state/RedisStateRepository.js`

**Implementation:** Redis with key patterns and TTLs (multi-instance deployments).

**Key Patterns:**

| Key Pattern | Type | TTL | Description |
|-------------|------|-----|-------------|
| `round:timer:{roundId}` | Hash | duration+300s | Timer state |
| `r2:team:{roundId}:{teamId}` | Hash | rotation*20 | R2 team state |
| `r2:assign:{roundId}:{teamId}` | Hash | rotation*20 | R2 assignments |
| `r3:cells:{puzzleId}` | Hash | 1800s | R3 filled cells |
| `r3:suggest:{puzzleId}` | Hash | 1800s | R3 proposals |
| `r3:votes:{puzzleId}` | Hash | 1800s | R3 votes |
| `active:{tournamentId}` | Hash | 120s | Active players |

**Atomic Operations:**

```javascript
async acquireRound2Puzzle(roundId, teamId, userId, puzzleId) {
  const key = `r2:assign:${roundId}:${teamId}`;

  // Check all existing assignments
  const assignments = await this.redis.hgetall(key);
  const values = Object.values(assignments);
  if (values.includes(String(puzzleId))) {
    return false; // Already taken
  }

  // Atomic set (HSETNX = set if not exists)
  const result = await this.redis.hsetnx(key, String(userId), String(puzzleId));
  return result === 1;
}

async claimRound3Cell(puzzleId, row, col, value) {
  const key = `r3:cells:${puzzleId}`;
  const field = `${row},${col}`;

  // HSETNX = atomic first-writer-wins
  const result = await this.redis.hsetnx(key, field, String(value));
  return result === 1;
}
```

---

## WebSocket Layer

### EmissionBus

**Location:** `src/ws/EmissionBus.js`

**Purpose:** Decouple round engines from Socket.IO transport.

```javascript
const { EventEmitter } = require('events');

class EmissionBus extends EventEmitter {
  constructor() {
    super();
  }

  emit(emission) {
    this.emit('emission', emission);
  }

  emitAll(emissions) {
    emissions.forEach(e => this.emit('emission', e));
  }

  emitImmediate(emission) {
    this.emit('immediate', emission);
  }
}
```

**Channels:**
- `'emission'`: Standard emissions (batched, logged)
- `'immediate'`: High-priority emissions (sent immediately)

---

### SocketManager

**Location:** `src/ws/SocketManager.js`

**Purpose:** Bridge between EmissionBus and Socket.IO rooms.

```javascript
class SocketManager {
  constructor(io, emissionBus) {
    this.io = io;
    this.emissionBus = emissionBus;
  }

  setup(orchestrator) {
    // Listen for emissions
    this.emissionBus.on('emission', (emission) => {
      const { target, targetId, event, payload } = emission;
      const room = this.getRoom(target, targetId);
      this.io.to(room).emit('event', { type: event, payload });
    });

    // Socket connection handler
    this.io.on('connection', (socket) => {
      const userId = socket.handshake.auth.userId;

      // Join user room
      socket.join(`user_${userId}`);

      // Join tournament room
      socket.on('join', ({ tournamentId }) => {
        socket.join(`tournament_${tournamentId}`);
      });

      // Join team room
      socket.on('joinTeam', ({ teamId }) => {
        socket.join(`team_${teamId}`);
      });

      // Game events
      socket.on('event', async (event) => {
        await this.handleEvent(socket, orchestrator, event);
      });

      // Disconnect
      socket.on('disconnect', () => {
        // Cleanup active player status
      });
    });
  }

  getRoom(target, targetId) {
    if (target === 'tournament') return `tournament_${targetId}`;
    if (target === 'team') return `team_${targetId}`;
    if (target === 'user') return `user_${targetId}`;
    throw new Error(`Unknown target: ${target}`);
  }

  async handleEvent(socket, orchestrator, event) {
    const userId = socket.handshake.auth.userId;
    const { type, payload } = event;

    switch (type) {
      case 'SUBMIT_ANSWER':
        await orchestrator.submitAnswer(
          payload.tournamentId,
          payload.roundId,
          userId,
          payload.puzzleId,
          payload.submissionType,
          payload.data
        );
        break;

      case 'ROUND2_CELL_UPDATE':
        await orchestrator.updateRound2Cell(
          payload.roundId,
          payload.puzzleId,
          userId,
          payload.row,
          payload.col,
          payload.value
        );
        break;

      case 'ROUND3_PROPOSE_CELL':
        await orchestrator.proposeRound3Cell(
          payload.tournamentId,
          payload.roundId,
          payload.puzzleId,
          userId,
          payload.row,
          payload.col,
          payload.value
        );
        break;

      // ... (20+ event types)
    }
  }
}
```

---

## Services

### PuzzleAssignmentService

**Location:** `src/services/PuzzleAssignmentService.js`

**Purpose:** Assign puzzles to teams with stratified sampling for difficulty balance.

**Key Method:**

```javascript
async assignPerTeamPuzzles(roundId, teams, puzzles) {
  // Check if already assigned (idempotent)
  const existing = await this.repos.teamPuzzleSets.loadByRound(roundId);
  if (existing.length > 0) return existing;

  // Separate JOC and FINAL pools
  const jocPuzzles = puzzles.filter(p => p.puzzle_type === 'JOC');
  const finalPuzzles = puzzles.filter(p => p.puzzle_type === 'FINAL');

  // Stratify by difficulty
  const easy = jocPuzzles.filter(p => p.difficulty === 'EASY');
  const medium = jocPuzzles.filter(p => p.difficulty === 'MEDIUM');
  const hard = jocPuzzles.filter(p => p.difficulty === 'HARD');

  // Assign to each team
  for (const team of teams) {
    // Shuffle pools
    this.shuffle(easy);
    this.shuffle(medium);
    this.shuffle(hard);

    // Pick balanced set (8E+6M+2H for R2)
    const selected = [
      ...easy.splice(0, 8),
      ...medium.splice(0, 6),
      ...hard.splice(0, 2)
    ];

    // Assign 9-letter word
    const word = this.words[Math.floor(Math.random() * this.words.length)];

    // Persist
    await this.repos.teamPuzzleSets.persist(
      round.tournament_id,
      roundId,
      team.id,
      word,
      selected.map(p => p.id).join(',')
    );
  }
}
```

---

### PuzzleBankService

**Location:** `src/services/PuzzleBankService.js`

**Purpose:** Manage puzzle bank (generate, import, delete).

**Storage:** `server/data/puzzle-bank.json`

**Key Methods:**

```javascript
generatePuzzles({ roundType, teamsCount }) {
  const puzzles = [];

  if (roundType === 'ROUND1_NINE_ONE') {
    // Generate 9 JOC + 1 FINAL per team
    for (let i = 0; i < teamsCount; i++) {
      for (let j = 0; j < 9; j++) {
        puzzles.push(SudokuGenerator.generateRound1Puzzle());
      }
      puzzles.push(SudokuGenerator.generateRound1FinalPuzzle());
    }
  } else if (roundType === 'ROUND2_RELAY') {
    // Generate 16 puzzles per team (8E+6M+2H)
    for (let i = 0; i < teamsCount; i++) {
      for (let j = 0; j < 8; j++) puzzles.push(SudokuGenerator.generateRound2EasyPuzzle());
      for (let j = 0; j < 6; j++) puzzles.push(SudokuGenerator.generateRound2Puzzle());
      for (let j = 0; j < 2; j++) puzzles.push(SudokuGenerator.generateRound2HardPuzzle());
    }
  } else if (roundType === 'ROUND3_COLLABORATE') {
    // Generate 10 puzzles (5E+3M+2H)
    for (let j = 0; j < 5; j++) puzzles.push(SudokuGenerator.generateRound3EasyPuzzle());
    for (let j = 0; j < 3; j++) puzzles.push(SudokuGenerator.generateRound3MediumPuzzle());
    for (let j = 0; j < 2; j++) puzzles.push(SudokuGenerator.generateRound3HardPuzzle());
  }

  // Append to bank
  this.bank.puzzles.push(...puzzles);
  this.save();

  return { generated: puzzles.length, totalInBank: this.bank.puzzles.length };
}
```

---

## Puzzle Generation

### SudokuGenerator

**Location:** `src/utils/sudokuGenerator.js`

**Algorithm:**

1. **Generate Solution:** Backtracking with shuffled candidates
2. **Create Puzzle:** Remove cells based on difficulty
3. **Optional Symmetry:** Mirror removal for aesthetics

**Backtracking Solver:**

```javascript
static _solve(grid) {
  const empty = this._findEmpty(grid);
  if (!empty) return true; // Solved

  const [row, col] = empty;
  const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);

  for (const num of candidates) {
    if (this._isValid(grid, row, col, num)) {
      grid[row][col] = num;
      if (this._solve(grid)) return true;
      grid[row][col] = 0; // Backtrack
    }
  }

  return false;
}
```

**Cell Removal:**

```javascript
static createPuzzle(difficulty) {
  // Generate full solution
  const solution = Array(9).fill().map(() => Array(9).fill(0));
  this._solve(solution);

  // Copy solution
  const puzzle = solution.map(row => [...row]);

  // Remove cells based on difficulty
  const emptyCells = {
    EASY: 25,
    MEDIUM: 30,
    HARD: 40
  }[difficulty];

  let removed = 0;
  while (removed < emptyCells) {
    const row = Math.floor(Math.random() * 9);
    const col = Math.floor(Math.random() * 9);

    if (puzzle[row][col] !== 0) {
      puzzle[row][col] = 0;
      removed++;

      // Optional: mirror removal for symmetry
      if (Math.random() > 0.5) {
        const mirrorRow = 8 - row;
        const mirrorCol = 8 - col;
        if (puzzle[mirrorRow][mirrorCol] !== 0) {
          puzzle[mirrorRow][mirrorCol] = 0;
          removed++;
        }
      }
    }
  }

  return { initialGrid: puzzle, solution };
}
```

---

## Error Handling

### Custom Error Classes

**Location:** `src/engine/errors.js`

```javascript
class GameError extends Error {
  constructor(message, code = 40000) {
    super(message);
    this.code = code;
  }
}

class NotFoundError extends GameError {
  constructor(message) {
    super(message, 40400);
  }
}

class UnauthorizedError extends GameError {
  constructor(message) {
    super(message, 40100);
  }
}

class ForbiddenError extends GameError {
  constructor(message) {
    super(message, 40300);
  }
}
```

**Usage:**

```javascript
if (!tournament) {
  throw new NotFoundError('赛事不存在');
}

if (user.role !== 'ADMIN') {
  throw new ForbiddenError('权限不足');
}
```

---

## Logging & Debugging

### Console Logging

**Current State:** Minimal logging (console.log for errors).

**Recommended:** Use `winston` or `pino` for structured logging:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

logger.info('Tournament started', { tournamentId });
logger.error('Database error', { error: err.message });
```

---

## Testing

### Current State

No automated tests in the backend codebase.

### Recommended Testing Strategy

**1. Unit Tests (Jest):**

```javascript
test('ScoringService calculates time bonus', () => {
  const bonus = ScoringService.calculateTimeBonus(180, 300); // 3min remaining, 5min total
  expect(bonus).toBe(9); // 3 * 3pts/min
});
```

**2. Integration Tests (Supertest):**

```javascript
const request = require('supertest');
const app = require('../src/index');

test('POST /api/auth/login returns token', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'password' });

  expect(res.body.code).toBe(200);
  expect(res.body.data.token).toBeDefined();
});
```

**3. Database Tests:**

```javascript
test('UserRepository creates user', async () => {
  const user = await repos.users.create({
    username: 'testuser',
    password: 'hash',
    role: 'PLAYER'
  });

  expect(user.id).toBeDefined();
  expect(user.username).toBe('testuser');
});
```

---

## Performance Optimization

### Database Queries

**N+1 Problem:**

```javascript
// BAD: N+1 queries
const teams = await repos.teams.findByTournament(tournamentId);
for (const team of teams) {
  team.members = await repos.teams.getMembers(team.id); // N queries
}

// GOOD: Single JOIN query
const teams = await repos.teams.findByTournamentWithMembers(tournamentId);
```

### Caching

**Redis Caching:**

```javascript
async getTournament(id) {
  // Check cache
  const cached = await this.redis.get(`tournament:${id}`);
  if (cached) return JSON.parse(cached);

  // Fetch from DB
  const tournament = await this.repos.tournaments.findById(id);

  // Cache for 60s
  await this.redis.setex(`tournament:${id}`, 60, JSON.stringify(tournament));

  return tournament;
}
```

---

## Security

### SQL Injection Prevention

**All queries use parameterized statements:**

```javascript
// SAFE: Parameterized
const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

// UNSAFE: String concatenation (NEVER DO THIS)
const user = await db.get(`SELECT * FROM users WHERE username = '${username}'`);
```

### Password Hashing

**bcrypt with salt rounds:**

```javascript
const hash = bcrypt.hashSync(password, 10); // 10 salt rounds
const valid = bcrypt.compareSync(inputPassword, hash);
```

### Rate Limiting

**Applied to login endpoint:**

```javascript
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { code: 42900, message: '登录尝试过多' }
});
```

---

## Deployment

### Docker Setup

**Dockerfile:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

**docker-compose.yml:**

```yaml
version: '3.8'
services:
  server:
    build: ./server
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/sudoku_arena
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:12
    environment:
      - POSTGRES_DB=sudoku_arena
      - POSTGRES_PASSWORD=password
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:6-alpine

volumes:
  pgdata:
```

---

## Conclusion

This backend codebase demonstrates solid Node.js/Express patterns with clear separation of concerns (repository pattern, strategy pattern, emission pattern). The architecture supports real-time multiplayer gameplay with robust race condition prevention and scalable state management.

**Key Takeaways:**
- Repository pattern abstracts database access
- Round engines encapsulate game logic
- Emission pattern decouples engines from transport
- State repository supports both memory and Redis

**Next Steps for New Developers:**
1. Read `GameOrchestrator.js` to understand coordination flow
2. Study `Round2Engine.js` for race condition prevention
3. Experiment with `StateRepository` (try adding new state types)
4. Add unit tests for critical services

---

**Document Version:** 1.0 (body) - see August 2026 Updates at top for current state
**Last Updated:** 2026-07-24 (body) / 2026-08-23 (updates section)
**Audience:** Junior Backend Developers
**Language:** English
