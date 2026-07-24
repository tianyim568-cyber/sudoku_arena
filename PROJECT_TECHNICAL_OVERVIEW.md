# Sudoku Arena — Technical Overview

## Project Summary

Sudoku Arena is a real-time multiplayer competitive Sudoku platform built for Chinese educational institutions. The system supports tournament-style gameplay with three distinct round types, team-based competition, and live WebSocket synchronization.

**Primary Use Case:** Classroom competition where students (players) solve Sudoku puzzles under time pressure, monitored by teachers (judges), with administrators managing the puzzle bank and tournament setup.

**Key Differentiator:** Three specialized round types with different collaboration models — solo relay, team rotation, and consensus-based collaboration — each requiring distinct backend coordination strategies.

---

## Architecture Overview

### Technology Stack

**Backend (Node.js/Express)**
- Runtime: Node.js with Express.js 4
- Real-time: Socket.IO 4 for bidirectional WebSocket communication
- Database: PostgreSQL 12+ with `pg` driver (connection pooling)
- State Management: Optional Redis (ioredis) with in-memory fallback
- Authentication: JWT (jsonwebtoken) with bcrypt password hashing
- Rate Limiting: express-rate-limit for API protection

**Frontend (React)**
- Framework: React 19 with Vite 8 (ESM build)
- Routing: React Router v7
- Real-time Client: Socket.IO Client 4.8
- Styling: Tailwind CSS v4 (via @tailwindcss/vite plugin)
- State: React hooks (useState, useEffect, useRef, useCallback)

**Deployment**
- Platform: Alibaba Cloud (ECS + RDS PostgreSQL + Redis)
- Container: Docker with multi-stage build
- Proxy: Nginx reverse proxy (not included in repo, assumed external)

---

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                         │
│  React SPA (Vite dev server / static build)                 │
│  Socket.IO Client (single persistent connection)            │
│  REST API client (fetch-based)                              │
└────────────┬────────────────────────────────┬───────────────┘
             │ WebSocket                      │ HTTPS
             │                                │
┌────────────▼────────────────────────────────▼───────────────┐
│                      Server Layer                           │
│  Express.js HTTP API                                        │
│  Socket.IO Server (rooms: tournament_*, team_*, user_*)     │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │         GameOrchestrator (Coordinator)             │    │
│  │  - Holds NO in-memory state                        │    │
│  │  - Routes commands to RoundEngines                 │    │
│  │  - Processes emissions via EmissionBus             │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                           │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │              RoundEngines (Strategy Pattern)       │    │
│  │  Round1Engine │ Round2Engine │ Round3Engine        │    │
│  │  - Encapsulate round-specific logic               │    │
│  │  - Return emissions (not send directly)           │    │
│  │  - Use StateRepository for ephemeral data         │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                           │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │              StateRepository (Interface)           │    │
│  │  MemoryStateRepository │ RedisStateRepository      │    │
│  │  - Timers, R2 assignments, R3 cells/proposals     │    │
│  │  - Atomic operations (acquire, claim)             │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                           │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │              Repositories (Database Access)        │    │
│  │  UserRepository, TournamentRepository, etc. (9)    │    │
│  │  - Abstract SQL queries                            │    │
│  │  - Injected via dependency injection               │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                           │
└─────────────────┼───────────────────────────────────────────┘
                  │ SQL (pg driver)
                  │
┌─────────────────▼───────────────────────────────────────────┐
│                    Database Layer                           │
│  PostgreSQL (11 tables)                                     │
│  Optional Redis (ephemeral state cache)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Design Patterns

### 1. Repository Pattern

All database access is abstracted through repository classes (9 total):
- `UserRepository`, `TournamentRepository`, `RoundRepository`, `PuzzleRepository`
- `TeamRepository`, `SubmissionRepository`, `ScoreRepository`
- `PlayerStateRepository`, `TeamPuzzleSetRepository`

**Rationale:** Decouples business logic from SQL, enables testing with mock repos, and centralizes query logic.

**Dependency Injection:** Repositories are instantiated in `server/src/db/index.js` and injected into routers and services via factory functions.

### 2. Strategy Pattern (Round Engines)

Each round type has its own engine class extending `RoundEngine` base:
- `Round1Engine` (Nine-One): Single-cell submissions, 9-letter word clue system
- `Round2Engine` (Relay): 60-second rotation, atomic puzzle acquisition, difficulty-based scoring
- `Round3Engine` (Collaborate): Propose/accept/vote workflow, unanimous consensus model

**Rationale:** Each round has fundamentally different rules, scoring, and state management. Strategy pattern allows polymorphic dispatch without conditional branching.

### 3. Emission Pattern (Decoupled Event Dispatch)

RoundEngines return **emission objects** instead of calling Socket.IO directly:

```javascript
{
  target: 'tournament' | 'team' | 'user',
  targetId: 123,
  event: 'PUZZLE_SOLVED',
  payload: { ... }
}
```

**EmissionBus** (EventEmitter-based) collects emissions and dispatches to **SocketManager**, which routes to Socket.IO rooms.

**Rationale:** Engines remain transport-agnostic (can be tested without sockets), and emissions can be batched, logged, or replayed.

### 4. State Repository Pattern (Ephemeral State Abstraction)

`StateRepository` defines an interface for ephemeral state (timers, R2 assignments, R3 proposals) with two implementations:
- **MemoryStateRepository:** In-memory Maps (single-instance deployments)
- **RedisStateRepository:** Redis with key patterns and TTLs (multi-instance deployments)

**Atomic Operations:**
- `acquireRound2Puzzle()`: Prevents race conditions during R2 rotation
- `claimRound3Cell()`: First-writer-wins for R3 cell fills (HSETNX in Redis)

**Rationale:** Allows horizontal scaling with Redis without changing engine logic.

---

## Game Round Mechanics

### Round 1: "Nine-One" (九宫一填)

**Objective:** Each team solves 9 "JOC" (Just One Cell) puzzles + 1 FINAL puzzle.

**Mechanics:**
- Each JOC puzzle has exactly 1 empty cell. Player submits a single value.
- Correct submission reveals one letter of a 9-letter word (assigned per team).
- After all 9 JOC puzzles solved, FINAL puzzle unlocks.
- FINAL requires full grid submission (all 81 cells).

**Scoring:**
- JOC: 10 points each
- FINAL: Variable (base + time bonus: +3 points per minute remaining)

**State Management:**
- `round1Progress` object tracks solved puzzles, revealed letters, final unlock status
- Persisted via `SubmissionRepository` (correct submissions) and `PuzzleRepository` (letter updates)

**Key File:** `server/src/engine/Round1Engine.js`

---

### Round 2: "Relay" (接力轮转)

**Objective:** Each team solves 16 puzzles (8 Easy, 6 Medium, 2 Hard) with 60-second rotation.

**Mechanics:**
- 4 players per team, each assigned 1 puzzle at a time.
- Every 60 seconds, puzzles rotate to the next player.
- Players can submit individual cells or full grids.
- Correct submission auto-assigns next available puzzle.

**Rotation Logic:**
- `Round2NotificationService` schedules rotation warnings (5-second countdown).
- At rotation time, `rotatePuzzles()` reassigns puzzles using atomic `acquireRound2Puzzle()`.
- Unassigned players (if acquire fails) trigger gap-fill retry loop.

**Scoring:**
- Easy: 8 points, Medium: 16 points, Hard: 20 points
- Completion bonus: +3 points per minute remaining (if all 16 solved)

**Race Condition Prevention:**
- `acquireRound2Puzzle()` checks all existing assignments before atomic set.
- Retry loop in `submitAnswer()` shuffles available puzzles and tries each until one succeeds.

**Key Files:**
- `server/src/engine/Round2Engine.js`
- `server/src/services/Round2NotificationService.js`
- `server/src/state/StateRepository.js` (R2 team state methods)

---

### Round 3: "Collaborate" (协作攻坚)

**Objective:** Team solves 1 shared puzzle (5 Easy, 3 Medium, 2 Hard difficulty mix) via consensus.

**Mechanics:**
- Any player can **propose** a cell value (row, col, value).
- Other players **accept** or **reject** the proposal.
- **Unanimous approval** required: ALL online teammates must accept.
- Proposer cannot approve/reject their own proposal.
- Any single rejection kills the proposal immediately.
- On consensus, `claimRound3Cell()` atomically fills the cell.

**Consensus Model:**
- Online status determined by `StateRepository.getActivePlayers()` (heartbeat-based).
- Votes tracked in `r3:suggest:{puzzleId}` hash (Redis) or Map (memory).
- `acceptProposal()` checks if all online teammates have approved.

**Scoring:**
- Easy: 10 points, Medium: 20 points, Hard: 45 points
- Completion bonus: +5 points per minute remaining

**Key Files:**
- `server/src/engine/Round3Engine.js`
- `server/src/services/Round3CollaborationService.js`
- `server/src/state/StateRepository.js` (R3 cells, suggestions, votes)

---

## Real-Time Communication

### WebSocket Architecture

**Connection Lifecycle:**
1. Client connects via Socket.IO with JWT in `auth.token`.
2. Server validates token, extracts `userId`, joins user to `user_{userId}` room.
3. Client emits `join` with `tournamentId` → joins `tournament_{id}` room.
4. Client emits `joinTeam` with `teamId` → joins `team_{teamId}` room.
5. On disconnect, client leaves all rooms.

**Event Channel:**
All game events use a single `'event'` channel with type-based dispatch:

```javascript
socket.emit('event', { type: 'SUBMIT_ANSWER', payload: { ... } });
socket.on('event', (event) => {
  switch (event.type) { ... }
});
```

**Room-Based Routing:**
- `tournament_{id}`: Broadcast to all participants (round started, timer tick)
- `team_{id}`: Broadcast to team members (puzzle solved, score update)
- `user_{id}`: Targeted to specific user (puzzle assigned, cell conflict)

### Server-Authoritative Timer

**Architecture:**
- Server stores `turnEndsAt` (Unix timestamp in milliseconds).
- Client computes `remaining = max(0, ceil((turnEndsAt - Date.now()) / 1000))`.
- Client uses `requestAnimationFrame` loop for smooth countdown (no drift).
- Server emits `TIMER_TICK` every ~10 seconds for recalibration.

**Pause/Resume:**
- Pause: Server stores `remainingAtPause` (seconds remaining at pause time).
- Resume: Server recalculates `turnEndsAt = Date.now() + remainingAtPause * 1000`.

**Key Files:**
- `server/src/engine/TimerService.js` (server-side timestamp management)
- `client/src/hooks/useTimer.js` (client-side rAF countdown)

---

## Database Schema

### Core Tables (11 total)

```sql
users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'JUDGE', 'PLAYER')),
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
)

tournaments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
)

rounds (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  name VARCHAR(100),
  round_type VARCHAR(50) NOT NULL,
  duration_seconds INTEGER,
  status VARCHAR(20) DEFAULT 'NOT_STARTED',
  turn_ends_at BIGINT,
  remaining_at_pause INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
)

puzzles (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  puzzle_type VARCHAR(20),
  difficulty VARCHAR(20),
  initial_grid JSON NOT NULL,
  solution JSON NOT NULL,
  letter VARCHAR(1),
  points INTEGER DEFAULT 10,
  order_in_round INTEGER,
  team_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
)

teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)

team_members (
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER,
  PRIMARY KEY (team_id, player_id)
)

tournament_judges (
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  judge_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, judge_id)
)

player_puzzle_assignments (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  current_grid JSON,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
)

submissions (
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
)

scores (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  score_type VARCHAR(20) CHECK (score_type IN ('TEAM', 'INDIVIDUAL')),
  total_points INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tournament_id, round_id, team_id, player_id, score_type)
)

team_puzzle_sets (
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  word VARCHAR(9),
  puzzle_ids TEXT,
  PRIMARY KEY (round_id, team_id)
)
```

### Key Relationships

- **Tournament → Rounds → Puzzles:** One-to-many cascade
- **Teams → Team Members:** Many-to-many via `team_members` junction table
- **Player → Puzzle Assignments:** Tracks which player is solving which puzzle (R2 rotation)
- **Submissions:** Immutable log of all attempts (correct/incorrect)
- **Scores:** Aggregated points per team/player per round (upsert semantics)

---

## Authentication & Authorization

### JWT-Based Auth Flow

1. **Login:** POST `/api/auth/login` with `{ username, password }`.
2. **Validation:** Server checks credentials via `UserRepository.findByUsername()`, verifies bcrypt hash.
3. **Token Issuance:** Server signs JWT with `{ userId, role }` payload (24h expiry).
4. **Client Storage:** Token stored in `localStorage`, attached to `Authorization: Bearer <token>` header.
5. **Request Validation:** `authMiddleware` extracts token, verifies signature, attaches `req.user`.
6. **Role Checks:** `roleMiddleware('ADMIN', 'JUDGE')` enforces RBAC on protected routes.

**Rate Limiting:** `/api/auth/login` limited to 5 requests per minute per IP (express-rate-limit).

**Key Files:**
- `server/src/middleware/auth.js` (JWT sign/verify/role check)
- `server/src/routes/auth.js` (login endpoint)
- `client/src/hooks/useAuth.jsx` (AuthProvider, token management)

---

## Puzzle Generation

### Algorithm

**Sudoku Generator:** Backtracking solver with shuffled candidate selection.

1. **Generate Solution:** Fill 9x9 grid using backtracking with random valid candidates.
2. **Create Puzzle:** Remove cells based on difficulty (empty cell count).
3. **Optional Symmetry:** Mirror removal for aesthetic balance.

**Difficulty Levels (Empty Cell Count):**

| Round | Easy | Medium | Hard |
|-------|------|--------|------|
| R1 JOC | 1 | — | — |
| R2 | 25 | 30 | 40 |
| R3 | 20 | 35 | 50 |

### Puzzle Bank Management

**Storage:** `server/data/puzzle-bank.json` (pre-generated pool).

**Generation:**
- `PuzzleBankService.generatePuzzles(roundType, teamsCount)` creates puzzles for one round.
- `PuzzleBankService.generateBulk(teamsCount)` creates puzzles for all 3 rounds.

**Import to Round:**
- `PuzzleBankService.importToRound(roundId)` assigns puzzles from bank to teams.
- R1: 9 JOC + 1 FINAL per team, with 9-letter word assignment.
- R2: 16 puzzles per team (8E+6M+2H), stratified sampling for balance.
- R3: 10 puzzles per round (5E+3M+2H), shared across all teams.

**Idempotent Restart:** `team_puzzle_sets` table persists assignments, allowing round restart without re-assignment.

**Key Files:**
- `server/src/utils/sudokuGenerator.js` (algorithm)
- `server/src/services/PuzzleBankService.js` (bank management)
- `server/src/services/PuzzleAssignmentService.js` (per-team assignment)

---

## Deployment Configuration

### Alibaba Cloud Stack

- **Compute:** ECS (Elastic Compute Service) — 2 vCPU, 4GB RAM
- **Database:** RDS PostgreSQL 12 (managed, auto-backup)
- **Cache:** Redis 6 (managed, optional)
- **Proxy:** Nginx reverse proxy (assumed external, not in repo)

### Docker Setup

**Multi-Stage Build:**
1. **Build Stage:** Node.js 20 Alpine, `npm ci`, `npm run build` (client + server).
2. **Production Stage:** Node.js 20 Alpine, copy built assets, expose port 3001.

**Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string (optional)
- `JWT_SECRET`: Secret key for token signing
- `PORT`: Server port (default 3001)

**Key Files:**
- `Dockerfile` (multi-stage build)
- `docker-compose.yml` (local dev with PostgreSQL + Redis)
- `deploy/aliyun-setup.sh` (Alibaba Cloud provisioning script)

---

## Known Issues & Technical Debt

### Race Conditions (Fixed)

**Round 2 Puzzle Assignment:**
- **Issue:** Concurrent `submitAnswer` + `rotatePuzzles` could assign same puzzle to multiple players.
- **Fix:** Atomic `acquireRound2Puzzle()` with retry loop (shuffles candidates, tries each until one succeeds).

**Round 3 Cell Claims:**
- **Issue:** Two players proposing same cell simultaneously could both succeed.
- **Fix:** `claimRound3Cell()` uses Redis `HSETNX` (atomic first-writer-wins) or memory Map check.

### Performance Considerations

**Database Queries:**
- N+1 queries in `findByTournamentWithMembers()` (loops over teams, fetches members).
- **Mitigation:** Acceptable for small tournaments (<50 teams). For scale, use JOIN with GROUP BY.

**WebSocket Scalability:**
- Single Socket.IO server instance (no horizontal scaling without Redis adapter).
- **Mitigation:** Redis pub/sub adapter (`@socket.io/redis-adapter`) enables multi-instance deployments.

### Security

**SQL Injection:** All queries use parameterized statements (`?` placeholders converted to `$1, $2, ...`).

**XSS:** React's JSX escaping prevents most XSS. No `dangerouslySetInnerHTML` usage.

**CORS:** Configured in `server/src/index.js` (origin whitelist for production).

**Rate Limiting:** Only applied to `/api/auth/login`. Other endpoints unprotected.

---

## Testing Strategy

**Current State:** No automated tests in repository.

**Recommended:**
1. **Unit Tests:** Jest for utilities (`sudokuGenerator`, `ScoringService`).
2. **Integration Tests:** Supertest for API routes with test database.
3. **E2E Tests:** Playwright for critical flows (login, tournament start, puzzle submission).

---

## Future Enhancements

1. **Spectator Mode:** Allow non-participants to watch live game state.
2. **Replay System:** Record all submissions and emit replay timeline.
3. **Leaderboard:** Persistent tournament rankings with historical data.
4. **Mobile Optimization:** Responsive design for tablet/phone gameplay.
5. **AI Puzzle Generation:** Difficulty calibration via solver complexity metrics.

---

## File Structure

```
project_3/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── api/               # REST client + Socket.IO wrapper
│   │   ├── components/        # Reusable UI (SudokuGrid, TimerDisplay, PuzzleBoard)
│   │   ├── hooks/             # Custom hooks (useAuth, useGameSocket, useTimer)
│   │   ├── pages/             # Route components (6 pages)
│   │   ├── App.jsx            # Router + AuthProvider
│   │   └── main.jsx           # Entry point
│   ├── index.html             # HTML template (lang="zh")
│   └── vite.config.js         # Vite config (proxy /api, /socket.io)
│
├── server/                    # Node.js backend (Express)
│   ├── src/
│   │   ├── config.js          # Centralized config (env vars)
│   │   ├── index.js           # Entry point (Express + Socket.IO setup)
│   │   ├── db/                # Database layer
│   │   │   ├── connection.js  # PostgreSQL pool + query helper
│   │   │   ├── index.js       # Repository factory (9 repos)
│   │   │   └── repositories/  # Repository classes (9 files)
│   │   ├── engine/            # Game logic
│   │   │   ├── GameOrchestrator.js
│   │   │   ├── RoundEngine.js (abstract base)
│   │   │   ├── Round1Engine.js, Round2Engine.js, Round3Engine.js
│   │   │   ├── ScoringService.js, TimerService.js
│   │   │   └── errors.js
│   │   ├── middleware/        # Express middleware (auth.js)
│   │   ├── routes/            # API routes (auth, tournaments, game, users, puzzleBank)
│   │   ├── services/          # Business logic services
│   │   │   ├── PuzzleAssignmentService.js
│   │   │   ├── PuzzleBankService.js
│   │   │   ├── Round2NotificationService.js
│   │   │   └── Round3CollaborationService.js
│   │   ├── state/             # Ephemeral state layer
│   │   │   ├── StateRepository.js (interface)
│   │   │   ├── MemoryStateRepository.js
│   │   │   ├── RedisStateRepository.js
│   │   │   └── index.js (factory)
│   │   ├── utils/             # Utilities
│   │   │   ├── db.js          # Schema + seeds
│   │   │   └── sudokuGenerator.js
│   │   ├── ws/                # WebSocket layer
│   │   │   ├── EmissionBus.js
│   │   │   └── SocketManager.js
│   │   └── data/              # Static data
│   │       └── words.json     # 9-letter word list (100 words)
│   └── data/
│       └── puzzle-bank.json   # Pre-generated puzzle pool
│
├── deploy/                    # Deployment scripts
│   └── aliyun-setup.sh        # Alibaba Cloud provisioning
│
├── Dockerfile                 # Multi-stage Docker build
├── docker-compose.yml         # Local dev (PostgreSQL + Redis)
└── README.md                  # Project overview
```

---

## Conclusion

Sudoku Arena is a well-architected real-time multiplayer platform with clear separation of concerns (repository pattern, strategy pattern, emission pattern). The codebase demonstrates strong understanding of race condition prevention (atomic acquires), server-authoritative timing, and scalable state management (Redis/memory abstraction).

**Strengths:**
- Clean architecture with dependency injection
- Robust race condition handling
- Flexible round system (easily extensible to new round types)
- Production-ready deployment configuration

**Areas for Improvement:**
- No automated test coverage
- N+1 queries in some repository methods
- Rate limiting only on login endpoint
- No horizontal scaling for WebSocket (requires Redis adapter)

**Recommended Next Steps:**
1. Add unit tests for core services (ScoringService, PuzzleAssignmentService)
2. Implement Redis pub/sub adapter for multi-instance Socket.IO
3. Add rate limiting to all API endpoints
4. Optimize N+1 queries with JOIN-based queries

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-24  
**Audience:** Developers (full-stack, backend, DevOps)  
**Language:** English
