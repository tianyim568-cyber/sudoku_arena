# Competition Platform — 14-Day MVP Development Plan

> **Document Version:** 1.0
> **Created:** August 5, 2026
> **Deadline:** August 18, 2026
> **Team:** Sylvain + Louise (both AI-assisted)

---

## 1. Executive Summary

This document is the authoritative MVP development plan for a **multi-tenant SaaS competition-management platform**. The repository already contains a working single-tenant Sudoku team-competition application ("Sudoku Arena") with three round types, real-time WebSocket gameplay, server-authoritative scoring, and participant import.

The 14-day plan transforms this existing application into a **multi-tenant, stage-aware, role-separated SaaS** with:

- Organization-level tenant isolation
- Four distinct roles (Super Admin, Organization Admin, Judge, Player)
- Competition-specific entry points for judges and players
- Individual AND team competition stages
- Automatic round progression within a stage
- Server-side scoring with completion-ratio algorithm
- Real-time big-screen display controlled by judge
- Category-based rankings (U6, U8, U12)
- Puzzle bank with PDF import pipeline
- Security hardening (authorization, input validation, rate limiting, headers)

**Critical finding:** The existing codebase is architecturally sound (Repository pattern, Strategy pattern for round engines, EmissionBus decoupling, StateRepository abstraction) but has **no multi-tenancy, no stages, no big-screen support, no individual competition mode, no PDF import, no security headers, and no tests**. The plan preserves the strong architecture and round engines while adding the missing structural layers.

---

## 2. Product Vision

A SaaS platform rented by organizations to run Sudoku/puzzle competitions. Organizations are provisioned manually (no payment/subscription in MVP). Each organization operates in full data isolation. Competitions support Individual and Team stages, each with configurable rounds. Judges control live competition flow. Players solve puzzles in-browser. Big screens display real-time rankings and player broadcasts. All scoring is server-authoritative with integer results.

---

## 3. MVP Scope

### In Scope (P0 + P1)

- Multi-tenant data isolation (organization_id on all tenant-scoped tables)
- Organization Admin registration/login with org creation
- Competition CRUD with stage configuration (Individual, Team)
- Automatic round progression within a stage (preparation → round → transition → next round)
- Player auto-save with server-side persistence
- Server-authoritative scoring using completion-ratio algorithm
- Category-based rankings (U6, U8, U12)
- Competition-specific entry points (/competition/{identifier})
- Judge control panel with participant monitoring
- Big-screen WebSocket connection with link-based setup
- Judge-controlled big-screen display modes
- Excel participant import with credential generation
- Judge creation with credential generation
- Puzzle bank with basic PDF import pipeline
- Security hardening (helmet, input validation, rate limiting, authorization enforcement)
- Comprehensive test suite for critical flows

### Out of Scope (P3 — Post-MVP)

- Payment/subscription management
- Full PK competition gameplay
- Advanced Super Admin analytics
- Universal PDF parser (build for known format only)
- Enterprise audit infrastructure
- Advanced analytics/reporting
- Horizontal WebSocket scaling (Redis adapter)
- Complex retention automation

---

## 4. Roles

| Role | Auth Method | Entry Point | Scope |
|------|-------------|-------------|-------|
| **Super Admin** | Username/password login | `/admin` (restricted) | Platform-wide: view orgs, monitor usage |
| **Organization Admin** | Registration + login | `/dashboard` | Their org's competitions, participants, judges, puzzles |
| **Judge** | Pre-created credentials | `/competition/{id}` | Live competition control for assigned competition |
| **Player** | Pre-created credentials | `/competition/{id}` | Solve puzzles in assigned competition |

---

## 5. User Flows

### Organization Admin Flow
```
Register → Login → Dashboard → Create Competition → Configure Stages/Rounds
→ Import Participants → Generate Credentials → Create Judges → Generate Judge Credentials
→ Import/Manage Puzzles → Assign Puzzles to Rounds → Publish Competition
→ Monitor (during competition) → View Results (after competition)
```

### Judge Flow
```
Open /competition/{id} → Login with credentials → Judge Control Panel
→ Start Stage → (Preparation auto-transitions) → Monitor Round
→ Optionally broadcast player to big screen → End round early (optional)
→ (Auto-transition to next round) → Stage complete → Start next stage
→ View final rankings
```

### Player Flow
```
Open /competition/{id} → Login with credentials → Waiting Screen
→ Judge starts stage → Preparation/Rules Screen (20-30s countdown)
→ Round 1 starts automatically → Solve puzzles (auto-save)
→ Round ends (timer or judge) → Scores calculated → Transition Screen
→ Round 2 starts automatically → ... → Stage complete
→ (Wait for next stage) → Team stage (if configured) → Competition complete
```

### Big Screen Flow
```
Judge clicks "Connect Big Screen" → Server generates temporary token URL
→ Operator opens URL in display browser → WebSocket connects
→ Display shows default competition screen → Judge controls display mode
→ (Ranking / Player Broadcast / Round Results / Final Ranking)
```

---

## 6. Competition Lifecycle

```
                    ┌──────────────────────────────────────────────────────┐
                    │                  COMPETITION                          │
                    │                                                      │
  WAITING ─────→ STAGE_STARTED ────→ PREPARATION ────→ ROUND_ACTIVE       │
                    │                                    │                 │
                    │                                    ↓                 │
                    │                              ROUND_FINISHED          │
                    │                                    │                 │
                    │                                    ↓                 │
                    │                              TRANSITION              │
                    │                                    │                 │
                    │                          ┌─────────┴─────────┐       │
                    │                          │                    │       │
                    │                    NEXT_ROUND           STAGE_FINISHED│
                    │                          │                    │       │
                    │                          ↓                    ↓       │
                    │                    ROUND_ACTIVE      WAITING_FOR_     │
                    │                                           NEXT_STAGE  │
                    │                                              │       │
                    │                                              ↓       │
                    │                                     NEXT_STAGE        │
                    │                                        │              │
                    │                                        ↓              │
                    │                              COMPETITION_FINISHED     │
                    └──────────────────────────────────────────────────────┘
```

**Key difference from existing code:** The existing system requires the judge to manually start each round. The MVP must add automatic round progression within a stage, with configurable preparation/transition durations.

---

## 7. Architecture Overview

### Existing Architecture (Preserved)
```
Client (React 19 + Vite 8 + Tailwind v4)
  ├── REST API (fetch) ──→ Express 4 ──→ Repository Layer ──→ PostgreSQL
  └── Socket.IO Client ──→ SocketManager ──→ EmissionBus ──→ GameOrchestrator
                                              ↑                  │
                                        StateRepository     Round Engines
                                       (Memory/Redis)      (R1/R2/R3 Strategy)
```

### Target Architecture (Added Layers)
```
Client
  ├── /admin/*          (Super Admin UI)
  ├── /dashboard/*      (Org Admin UI)
  ├── /competition/:id  (Competition entry → Judge/Player/Display)
  └── (existing routes preserved for backward compat during migration)

Server
  ├── middleware/
  │   ├── auth.js           (MODIFY: add org context to JWT)
  │   ├── tenantGuard.js    (NEW: enforce org_id on every query)
  │   ├── competitionAuth.js (NEW: competition-specific JWT for judges/players)
  │   └── validate.js       (NEW: input validation middleware)
  ├── models/               (NEW: organization model, stage model)
  ├── engine/
  │   ├── GameOrchestrator.js (MODIFY: stage-aware lifecycle)
  │   ├── StageManager.js     (NEW: auto-progression, preparation, transitions)
  │   ├── CompletionScorer.js (NEW: completion-ratio scoring)
  │   └── (existing round engines preserved)
  ├── ws/
  │   ├── SocketManager.js  (MODIFY: competition-scoped rooms, display support)
  │   └── DisplayManager.js (NEW: big-screen connection and state management)
  └── services/
      ├── PdfImportService.js (NEW: PDF extraction pipeline)
      └── (existing services preserved)
```

---

## 8. Existing Codebase Audit

### Technology Stack

| Layer | Technology | Version | Status |
|-------|-----------|---------|--------|
| Frontend | React | 19.2.7 | KEEP |
| Build | Vite | 8.1.1 | KEEP |
| CSS | Tailwind CSS | 4.3.2 | KEEP |
| Router | React Router DOM | 7.18.1 | KEEP |
| Real-time Client | Socket.IO Client | 4.8.3 | KEEP |
| Backend | Express | 4.22.2 | KEEP |
| Database | PostgreSQL | 12+ | KEEP |
| Real-time Server | Socket.IO | 4.8.3 | KEEP |
| Auth | JWT + bcryptjs | 9.0.3 / 3.0.3 | MODIFY |
| Excel | xlsx | 0.18.5 | KEEP |
| File Upload | multer | 2.2.0 | MODIFY |
| DB Driver | pg | 8.22.0 | KEEP |

### Design Patterns (All KEEP)

- **Repository Pattern:** 10 repository classes abstract all SQL
- **Strategy Pattern:** Round1Engine, Round2Engine, Round3Engine
- **Emission Pattern:** Engines return emissions, EmissionBus dispatches
- **State Repository:** Memory/Redis abstraction for ephemeral state
- **Factory Pattern:** Repository factory, state factory
- **Late-Join Pattern:** Reconnect state replay via orchestrator

---

## 9. Existing Features (KEEP)

| Feature | Implementation | Quality | Action |
|---------|---------------|---------|--------|
| Three round engines (R1 Nine-One, R2 Relay, R3 Collaborate) | Full strategy pattern | Good | **KEEP** — associate with Team stage |
| Server-authoritative timer | TimerService + client rAF | Good | **KEEP** — extend for stage transitions |
| WebSocket room architecture | 3-tier rooms (user/tournament/team) | Good | **KEEP** — add competition-scoped rooms |
| EmissionBus event decoupling | Engines → Bus → SocketManager | Excellent | **KEEP** |
| StateRepository abstraction | Memory + Redis implementations | Good | **KEEP** |
| Excel participant import | Parse + validate + bulk create + credentials | Good | **KEEP** — add org_id association |
| Credential generation | Auto username/password + export | Good | **KEEP** — improve password generation |
| Puzzle generation | sudokuGenerator.js | Good | **KEEP** |
| Late-join/reconnection | Comprehensive state replay | Good | **KEEP** |
| i18n (zh/en) | Context-based with server message translation | Good | **KEEP** |
| SudokuGrid component | 9x9 grid with round-specific behavior | Good | **KEEP** |
| Player game page | Thin orchestrator delegating to R1/R2/R3 views | Good | **KEEP** |
| Judge control page | Start/pause/resume/end, room status | Partial | **MODIFY** — add monitoring, big-screen control |
| Scoring service | Integer-based, no floating-point issues | Good | **KEEP** for team rounds; add CompletionScorer for individual |
| Pause/resume support | Timer save + recalculate on resume | Good | **KEEP** |
| Atomic R2 puzzle acquisition | HSETNX pattern | Good | **KEEP** |
| R3 collaboration (propose/accept/reject) | Full consensus workflow | Good | **KEEP** |

---

## 10. Features to Modify (MODIFY)

| Feature | Current State | Required Change | Effort |
|---------|--------------|-----------------|--------|
| **Authentication** | Single JWT with userId/role | Add organization_id to JWT; add competition-specific JWT for judges/players | Medium |
| **User model** | Flat: username/password/role | Add organization_id FK; add SUPER_ADMIN role; add competition-scoped user type | Medium |
| **Tournament model** | No stages, no org_id, flat round list | Add organization_id FK; add stages table; rounds belong to stages; add competition_identifier; add category support | High |
| **Authorization middleware** | Role-only checks | Add org_id verification; add competition membership verification; add tenant isolation on every query | High |
| **GameOrchestrator** | Manual round start, no stages, no auto-progression | Stage-aware lifecycle; automatic round progression; preparation/transition states | High |
| **SocketManager** | Tournament rooms, no display support | Competition-scoped rooms; display client management; role-based event filtering | High |
| **Competition state** | PENDING → IN_PROGRESS → FINISHED | Full state machine (WAITING → STAGE_STARTED → PREPARATION → ROUND_ACTIVE → ROUND_FINISHED → TRANSITION → ...) | High |
| **Ranking** | Query-based, client-side sort, no categories | Server-side ranking per category (U6/U8/U12); per round and aggregate | Medium |
| **Score model** | Per-round team/player scores | Add completion-ratio scoring; per-puzzle tracking; stage-level aggregation | Medium |
| **Frontend routes** | /login, /tournament/:id, /play/:id, /judge/:id | Add /competition/:identifier entry point; add /dashboard routes; add /admin routes | Medium |
| **File upload** | Extension-only validation | Add MIME type validation; magic byte checking; content validation | Low |
| **CORS** | Configurable origins | Review and restrict for production | Low |
| **Rate limiting** | Login only | Add rate limiting to registration, competition entry, display token, file uploads | Low |
| **Error handling** | Console.error, some stack traces exposed | Structured logging; no stack trace exposure; consistent error format | Low |

---

## 11. Features to Delete (DELETE)

| Feature | Reason |
|---------|--------|
| **demo.html** | Contains hardcoded credentials, client-side auth logic, not production-ready. Remove from repo root or move to archived/ |
| **Quick-login buttons on LoginPage** | Security risk — exposes credentials. Replace with standard login form |
| **Hardcoded dev JWT secret** (`sudoku-arena-dev-only-secret`) | Must require JWT_SECRET in all environments |
| **Default seed passwords** (admin123, judge123, player123) | Replace with randomly generated passwords for production seeds |
| **`.env` file with real credentials** | Database password "Matianyi" committed — must rotate and use `.env.example` only |

---

## 12. Features to Build (NEW)

| Feature | Description | Priority | Effort |
|---------|-------------|----------|--------|
| **Organization model + tenant isolation** | organizations table; organization_id on all tenant-scoped tables; tenantGuard middleware | P0 | High |
| **Stage model + StageManager** | stages table (type: INDIVIDUAL/TEAM/PK); auto-progression engine; preparation/transition states | P0 | High |
| **Competition-specific auth** | /competition/{identifier} login; temporary JWT scoped to competition; role detection | P0 | Medium |
| **Individual round types** | Individual-compatible round types (distinct from team R1/R2/R3); individual puzzle solving | P0 | High |
| **Completion-ratio scoring** | Server-side: compare initial state + solution + player state; completion percentage; integer rounding | P0 | Medium |
| **Big-screen connection** | Temporary token generation; display WebSocket; display client page; judge-controlled modes | P0 | Medium |
| **Big-screen display modes** | Default, live ranking, player broadcast, round ranking, final ranking | P1 | Medium |
| **Judge participant monitoring** | Participant list with status; hover info card; click for live view; broadcast action | P1 | Medium |
| **Live participant view** | Judge sees player's puzzle state in real-time via WebSocket | P1 | Medium |
| **Preparation/transition screens** | Rules display; 20-30s countdown; auto-transition between rounds | P0 | Medium |
| **Category ranking** | U6/U8/U12 per-stage rankings; individual and team | P1 | Medium |
| **PDF import pipeline** | PDF → extraction → structured puzzles → puzzle bank | P1 | High |
| **Dashboard UI** | Organization admin dashboard with navigation (Competitions, Puzzle Bank, Participants, etc.) | P0 | Medium |
| **Super Admin interface** | Minimal: view orgs, view competitions, platform info | P2 | Low |
| **Security headers** | Helmet.js; CSP; frame protection; HSTS | P0 | Low |
| **Input validation** | Zod or Joi schemas for all API inputs | P0 | Medium |
| **Structured logging** | Winston or Pino; log levels; auth failures; state changes | P1 | Low |
| **Test suite** | Authentication, tenant isolation, competition lifecycle, scoring, security | P0 | High |

---

## 13. Database Changes

### New Tables

#### organizations
```sql
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'basic',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### competition_stages
```sql
CREATE TABLE competition_stages (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_type TEXT NOT NULL,           -- INDIVIDUAL, TEAM, PK
  stage_order INTEGER NOT NULL,       -- execution order within competition
  status TEXT DEFAULT 'NOT_STARTED',  -- NOT_STARTED, IN_PROGRESS, FINISHED
  config JSONB DEFAULT '{}',          -- stage-specific configuration
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, stage_order)
);
```

#### display_sessions
```sql
CREATE TABLE display_sessions (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'PENDING',      -- PENDING, CONNECTED, DISCONNECTED, EXPIRED
  created_by INTEGER REFERENCES users(id),
  connected_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  display_mode TEXT DEFAULT 'default', -- default, ranking, player_broadcast, round_results, final_ranking
  broadcast_player_id INTEGER,         -- nullable: player being broadcast
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### round_results
```sql
CREATE TABLE round_results (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  stage_id INTEGER NOT NULL REFERENCES competition_stages(id),
  participant_id INTEGER REFERENCES participants(id),
  team_id INTEGER REFERENCES teams(id),
  puzzle_id INTEGER REFERENCES puzzles(id),
  initial_empty_cells INTEGER DEFAULT 0,
  correctly_filled_cells INTEGER DEFAULT 0,
  completion_ratio REAL DEFAULT 0,
  puzzle_points INTEGER DEFAULT 0,
  puzzle_max_points INTEGER DEFAULT 0,
  round_total_points INTEGER DEFAULT 0,
  time_bonus INTEGER DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### puzzle_bank
```sql
CREATE TABLE puzzle_bank (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  puzzle_type TEXT NOT NULL,           -- JOC, STANDARD, FINAL
  round_type TEXT NOT NULL,            -- compatible round types (JSON array)
  difficulty TEXT DEFAULT 'MEDIUM',
  initial_grid TEXT NOT NULL,
  solution TEXT NOT NULL,
  points INTEGER DEFAULT 100,
  metadata JSONB DEFAULT '{}',
  source TEXT,                         -- 'generated', 'pdf_import', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Modified Tables (Migration Required)

#### users — add organization support
```sql
ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'ORG_USER';
-- user_type: SUPER_ADMIN, ORG_USER, COMPETITION_JUDGE, COMPETITION_PLAYER
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_user_type ON users(user_type);
```

#### tournaments — add org + identifier + category
```sql
ALTER TABLE tournaments ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE tournaments ADD COLUMN identifier TEXT UNIQUE;  -- URL-safe competition identifier
ALTER TABLE tournaments ADD COLUMN category TEXT;           -- U6, U8, U12, OPEN
ALTER TABLE tournaments ADD COLUMN published BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_tournaments_org ON tournaments(organization_id);
CREATE INDEX idx_tournaments_identifier ON tournaments(identifier);
```

#### rounds — add stage association
```sql
ALTER TABLE rounds ADD COLUMN stage_id INTEGER REFERENCES competition_stages(id);
CREATE INDEX idx_rounds_stage ON rounds(stage_id);
```

#### participants — add organization
```sql
ALTER TABLE participants ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX idx_participants_org ON participants(organization_id);
CREATE INDEX idx_participants_category ON participants(category);
```

#### puzzles — add puzzle_bank reference
```sql
ALTER TABLE puzzles ADD COLUMN puzzle_bank_id INTEGER REFERENCES puzzle_bank(id);
ALTER TABLE puzzles ADD COLUMN initial_empty_cells INTEGER DEFAULT 0;
```

### Tenant Isolation Audit

Every table that contains organization-scoped data must have `organization_id` or be reachable through a foreign key chain that starts with an organization-scoped table:

| Table | Tenant Key | Isolation Method |
|-------|-----------|-----------------|
| organizations | id | Root tenant |
| users | organization_id | Direct FK |
| tournaments | organization_id | Direct FK |
| competition_stages | via tournament_id → tournaments.organization_id | FK chain |
| rounds | via stage_id → tournament → org | FK chain |
| puzzles | via round → stage → tournament → org | FK chain |
| teams | via tournament → org | FK chain |
| participants | organization_id | Direct FK |
| schools | via participants → org | FK chain |
| scores | via tournament → org | FK chain |
| submissions | via round → ... → org | FK chain |
| puzzle_bank | organization_id | Direct FK |
| display_sessions | via tournament → org | FK chain |

---

## 14. API Changes

### New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Organization admin registration (creates org + user) |
| POST | `/api/competitions/:identifier/login` | Public | Competition-specific login (judge/player) |
| GET | `/api/competitions/:identifier/info` | Public | Competition public info (name, status) |
| GET | `/api/dashboard` | Org Admin | Organization dashboard data |
| POST | `/api/competitions` | Org Admin | Create competition |
| GET | `/api/competitions` | Org Admin | List org's competitions |
| PUT | `/api/competitions/:id/stages` | Org Admin | Configure stages |
| POST | `/api/competitions/:id/publish` | Org Admin | Publish competition |
| POST | `/api/competitions/:identifier/judges` | Org Admin | Create judge for competition |
| GET | `/api/competitions/:identifier/judges` | Org Admin | List judges |
| GET | `/api/competitions/:identifier/participants` | Org Admin | List participants |
| GET | `/api/competitions/:identifier/ranking` | Auth | Get ranking (by category, stage) |
| POST | `/api/display/token` | Judge | Generate big-screen connection token |
| GET | `/api/display/:token` | Token | Validate display token, establish connection |
| PUT | `/api/display/mode` | Judge | Change big-screen display mode |
| GET | `/api/puzzle-bank` | Org Admin | List org's puzzle bank |
| POST | `/api/puzzle-bank/import-pdf` | Org Admin | Import puzzles from PDF |
| GET | `/api/admin/organizations` | Super Admin | List all organizations |
| GET | `/api/admin/stats` | Super Admin | Platform statistics |

### Modified Endpoints

| Existing Endpoint | Change Required |
|------------------|-----------------|
| `POST /api/auth/login` | Add organization context; validate org membership |
| `GET /api/tournaments` | Filter by organization_id |
| `GET /api/tournaments/:id` | Verify org membership |
| `POST /api/tournaments/:id/start` | Delegate to StageManager |
| `POST /api/tournaments/:id/rounds/:roundId/start` | Remove (auto-progression handles this) |
| `POST /submissions` | Add completion-ratio scoring |
| All participant endpoints | Add org_id scoping |
| All puzzle bank endpoints | Add org_id scoping |

---

## 15. WebSocket/Real-Time Architecture

### Existing (KEEP + MODIFY)

- Socket.IO 4 with JWT auth middleware
- 3-tier room system: `user_{id}`, `tournament_{id}`, `team_{tournamentId}_{teamId}`
- EmissionBus decoupling
- Late-join state replay

### Changes Required

| Change | Description |
|--------|-------------|
| Add competition rooms | `competition_{identifier}` for competition-scoped events |
| Add display room | `display_{tournamentId}` for big-screen clients |
| Add stage events | STAGE_STARTED, PREPARATION_STARTED, TRANSITION_STARTED |
| Add auto-progression events | ROUND_AUTO_START, PREPARATION_COUNTDOWN |
| Add display events | DISPLAY_MODE_CHANGED, DISPLAY_PLAYER_BROADCAST |
| Add participant monitoring | PARTICIPANT_STATE_UPDATE (to judge only) |
| Add live player view | PLAYER_GRID_UPDATE (to judge when monitoring specific player) |
| Role-based event filtering | Players cannot receive judge-only events |

### Display WebSocket Flow

```
Judge → POST /api/display/token → Server generates UUID token (5min TTL)
       → Server stores token in display_sessions table
       → Returns token to judge

Judge UI → Shows URL: /display/{token}
         → "Copy Link" button

Display Browser → Opens /display/{token}
               → Frontend validates token via REST
               → If valid: establishes WebSocket with token auth
               → Server marks display_session as CONNECTED
               → Display joins display_{tournamentId} room
               → Display receives current display_mode + data
               → Token is consumed (cannot be reused for new connections)

Judge → PUT /api/display/mode { mode: 'ranking' | 'player_broadcast', playerId? }
      → Server validates judge permission
      → Server updates display_session
      → Server emits DISPLAY_MODE_CHANGED to display room
      → Display browser renders new mode
```

---

## 16. Authentication & Authorization

### Authentication Architecture

```
Organization Admin:
  POST /api/auth/register → creates org + user → JWT (org_id, role=ORG_ADMIN)
  POST /api/auth/login    → validates credentials → JWT (org_id, role=ORG_ADMIN)

Super Admin:
  POST /api/admin/login   → validates SUPER_ADMIN → JWT (role=SUPER_ADMIN)

Judge / Player:
  POST /api/competitions/:identifier/login
    → validates credentials against competition-scoped user
    → JWT (competitionId, role, participantId/judgeId, orgId)
    → Short expiry (e.g., 8 hours for competition duration)
```

### Authorization Matrix

| Resource | Super Admin | Org Admin | Judge | Player |
|----------|-------------|-----------|-------|--------|
| All orgs | Read | - | - | - |
| Own org | - | Full | - | - |
| Other orgs | - | - | - | - |
| Competition (own org) | Read | Full | Assigned only | Assigned only |
| Competition (other org) | Read | - | - | - |
| Stage/Round control | - | Read | Write (assigned) | - |
| Player state | - | Read | Read (assigned comp) | Own only |
| Scores/Ranking | - | Read | Read (assigned comp) | Read (own comp) |
| Display control | - | - | Write (assigned comp) | - |
| Puzzle bank (own org) | - | Full | - | - |
| Participant data (own org) | - | Full | Read (assigned comp) | - |

### Tenant Isolation Enforcement

Every API endpoint and WebSocket event must pass through tenantGuard:

```javascript
// Pseudocode
function tenantGuard(req, res, next) {
  const userOrgId = req.user.organizationId;
  const requestedResourceId = req.params.id;

  // Look up resource's org
  const resourceOrgId = await getOrganizationIdForResource(requestedResourceId);

  if (userOrgId !== resourceOrgId) {
    return res.status(403).json({ code: 40301, message: 'Access denied' });
  }
  next();
}
```

---

## 17. Security Requirements

### Implemented via Helmet.js (Day 1)
- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (production only)
- `X-XSS-Protection` (legacy browser support)

### Input Validation (Day 2-3)
- Zod schemas for all request bodies
- Parameter validation (positive integers, UUID format, etc.)
- File upload: MIME type + magic byte validation + content size limits
- WebSocket message validation

### Rate Limiting (Day 2)
| Endpoint | Limit |
|----------|-------|
| POST /api/auth/login | 30 req / 15 min / IP |
| POST /api/auth/register | 5 req / 15 min / IP |
| POST /api/competitions/:id/login | 20 req / 10 min / IP |
| POST /api/display/token | 10 req / 5 min / user |
| POST file uploads | 10 req / 10 min / user |
| POST /api/puzzle-bank/import-pdf | 5 req / 10 min / user |

### Password Security
- bcryptjs with 10 rounds (existing — KEEP)
- Generated participant/judge passwords: random 8-char alphanumeric + hash
- Never return password hashes in API responses
- Credential export only through admin-controlled export endpoint

### Secrets Management
- JWT_SECRET required in all environments (remove dev default)
- Database credentials via environment variables only
- .env file added to .gitignore (currently committed — must rotate)
- No secrets in source control

---

## 18. Scoring System

### Team Rounds (Existing R1/R2/R3 — KEEP)

The existing scoring logic for team rounds is well-implemented with integer-only arithmetic. No changes needed to the core formulas:

- **R1 (Nine-One):** 10 pts per JOC + FINAL puzzle points + 3 pts/min time bonus
- **R2 (Relay):** 8/16/20 pts by difficulty + 3 pts/min completion bonus
- **R3 (Collaborate):** 10/20/45 pts by difficulty + 5 pts/min completion bonus

### Individual Rounds (NEW — Completion-Ratio Scoring)

```
For each puzzle:
  1. Server has: initial_grid, solution, player_submitted_grid
  2. Count totalOriginallyEmptyCells (cells that are 0/empty in initial_grid)
  3. Count correctlyFilledCells (cells where player_grid matches solution AND initial was empty)
  4. completionRatio = correctlyFilledCells / totalOriginallyEmptyCells
  5. rawScore = puzzleMaxPoints × completionRatio
  6. puzzleScore = ROUND(rawScore)  ← see rounding policy below
```

### Rounding Policy (OPEN DECISION — Default Recommendation)

**Recommended: Math.round() per puzzle, then sum.**

```javascript
const puzzleScore = Math.round(puzzleMaxPoints * completionRatio);
// 20 × 0.588 = 11.76 → rounds to 12
```

This must be confirmed as a product decision. Alternatives:
- `Math.floor()` — more conservative
- `Math.ceil()` — more generous
- Round after summing all raw scores — different result

### Server-Side Enforcement

All scoring calculations happen in `CompletionScorer.js` on the server. The client submits only the puzzle grid state. The server:

1. Receives player grid
2. Loads initial_grid + solution from database
3. Computes completion ratio
4. Calculates integer score
5. Persists to round_results table
6. Broadcasts score update via WebSocket

---

## 19. Ranking System

### Per-Round Ranking
```sql
SELECT participant_id, team_id, round_total_points, time_bonus,
       (round_total_points + time_bonus) AS final_score,
       submitted_at
FROM round_results
WHERE stage_id = $1 AND round_id = $2
ORDER BY final_score DESC, submitted_at ASC;
```

### Stage Ranking (Aggregate)
Sum of all round scores within a stage, per participant or team.

### Category Ranking
Filter by participant category (U6, U8, U12) before ranking.

### Final Competition Ranking
Sum of individual stage score + team stage score (if both exist).
**OPEN DECISION:** Exact aggregation formula for combined individual + team ranking.

---

## 20. Big-Screen Architecture

### Connection Model
```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   PLAYER     │         │    JUDGE     │         │ BIG SCREEN  │
│   Browser    │         │   Browser    │         │   Browser   │
└──────┬───────┘         └──────┬───────┘         └──────┬──────┘
       │                        │                        │
       │ Socket.IO              │ Socket.IO              │ Socket.IO
       │ (player JWT)           │ (judge JWT)            │ (display token)
       │                        │                        │
       ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER                                    │
│                                                                  │
│  SocketManager                                                   │
│    ├── competition_{id} room (players + judges)                  │
│    ├── display_{tournamentId} room (big screens)                 │
│    ├── team_{id}_{id} room (team collaboration)                  │
│    └── user_{id} room (individual messages)                      │
│                                                                  │
│  DisplayManager                                                  │
│    ├── Token generation + validation                             │
│    ├── Display mode state management                             │
│    └── Broadcast player state relay                              │
└─────────────────────────────────────────────────────────────────┘
```

### Display Modes

| Mode | Data Source | Description |
|------|------------|-------------|
| `default` | Competition info | Competition name, current stage/round, participant count |
| `live_ranking` | Real-time scores | Live ranking table updating as submissions arrive |
| `player_broadcast` | Player WebSocket state | Selected player's puzzle grid in real-time |
| `round_ranking` | Round results | Final ranking after round completion |
| `final_ranking` | All results | Competition final ranking by category |

### Security
- Display token: UUID, 5-minute expiry, single-use for connection
- Token stored in display_sessions table with expiration
- Display WebSocket has no user privileges — receive-only
- Reconnection: display can reconnect with same session if WebSocket drops (session not yet expired)

---

## 21. Testing Strategy

### Test Framework
- **Backend:** Jest + Supertest (API tests)
- **Frontend:** Vitest + React Testing Library (component tests)
- **E2E:** Playwright (critical flows only, time permitting)

### Test Categories

#### Authentication Tests (Day 4)
- [ ] Organization admin registration creates org + user
- [ ] Login returns valid JWT with org_id
- [ ] Invalid credentials rejected
- [ ] Expired token rejected
- [ ] Competition-specific login works for judges and players
- [ ] Competition login rejects non-members
- [ ] Super Admin login restricted

#### Tenant Isolation Tests (Day 4-5)
- [ ] Org A admin cannot list Org B competitions
- [ ] Org A admin cannot access Org B participants
- [ ] Org A admin cannot modify Org B puzzle bank
- [ ] JWT with Org A cannot access Org B API endpoints
- [ ] WebSocket room join validates competition membership

#### Competition Lifecycle Tests (Day 7-8)
- [ ] Create competition with stages
- [ ] Configure rounds within stages
- [ ] Publish competition
- [ ] Judge starts stage → preparation state
- [ ] Auto-transition from preparation to round
- [ ] Timer expires → round ends → scores calculated
- [ ] Auto-transition to next round
- [ ] Judge ends round early → same scoring flow
- [ ] All rounds complete → stage finishes
- [ ] Next stage can start

#### Scoring Tests (Day 9)
- [ ] Completion ratio: 0/51 cells = 0%
- [ ] Completion ratio: 30/51 cells ≈ 58.8%
- [ ] Completion ratio: 51/51 cells = 100%
- [ ] Integer rounding produces correct scores
- [ ] Incorrect cells do not reduce score
- [ ] Pre-filled cells are not scored
- [ ] Time bonus applied correctly
- [ ] Scores are always integers

#### Security Tests (Day 12-13)
- [ ] Player cannot call judge API endpoints
- [ ] Judge cannot access admin endpoints
- [ ] Invalid WebSocket subscriptions rejected
- [ ] Malicious file upload rejected (wrong MIME, oversized)
- [ ] SQL injection in parameters prevented
- [ ] Cross-tenant API access blocked
- [ ] Display token expires correctly
- [ ] Rate limiting blocks excessive requests

#### Integration Tests (Day 13-14)
- [ ] Full end-to-end competition flow (see Section 67 of requirements)
- [ ] Player disconnect + reconnect during round
- [ ] Judge disconnect + reconnect
- [ ] Big screen disconnect + reconnect
- [ ] Concurrent judge actions (no double-start)

---

## 22. Open Product Decisions

| # | Decision | Impact | Current Default | Status |
|---|----------|--------|-----------------|--------|
| 1 | Exact individual round types | Determines what puzzles/mechanics individual stage uses | Not defined — need specification | **OPEN** |
| 2 | Exact individual round rules | Scoring and gameplay for individual mode | Not defined | **OPEN** |
| 3 | Exact team round rules (if existing differs from spec) | May need adjustment to R1/R2/R3 | Existing R1/R2/R3 seem correct | **VERIFY** |
| 4 | Transition duration: 20 vs 30 seconds | Affects preparation/transition countdown | Recommend 20s | **OPEN** |
| 5 | Integer rounding policy | Math.round vs Math.floor vs Math.ceil | Recommend Math.round per puzzle | **OPEN** |
| 6 | Rounding: per puzzle or after total sum | Different final scores | Recommend per-puzzle rounding | **OPEN** |
| 7 | Final ranking aggregation across rounds | Sum? Average? Weighted? | Recommend sum of all round scores | **OPEN** |
| 8 | Team ranking aggregation method | Per-round team scores summed? | Existing: sum of team points | **VERIFY** |
| 9 | PDF structure / format | Determines extraction pipeline design | No sample PDF available | **OPEN — BLOCKING** |
| 10 | OCR requirements | Whether image-based PDFs need OCR | Unknown without sample | **OPEN** |
| 11 | Scoring metadata format in PDF | How points are encoded in PDF | Unknown | **OPEN** |
| 12 | Are all originally-empty cells scored equally? | Weight per cell | Assume yes (1 point per empty cell ratio) | **VERIFY** |
| 13 | Completion-time definition | When does the clock stop for tiebreaking? | Recommend: time of last submission | **OPEN** |
| 14 | Can judge end round when not everyone submitted? | Early termination policy | Recommend: yes, with confirmation | **OPEN** |
| 15 | Competition entry URL format | `/competition/{slug}` vs `/competition/{uuid}` | Recommend: URL-safe slug | **OPEN** |
| 16 | Can admin edit published competition? | Post-publication changes | Recommend: limited (no stage/round structure changes) | **OPEN** |
| 17 | What if participant disconnects during round? | Auto-submit current state? | Recommend: preserve last auto-saved state, score normally | **PROPOSED** |
| 18 | What if judge disconnects? | Competition pauses? | Recommend: server continues timer; auto-end round on expiry | **PROPOSED** |
| 19 | What if big screen disconnects? | Reconnection? | Recommend: auto-reconnect if token not expired | **PROPOSED** |
| 20 | What if server restarts during competition? | State recovery? | Recommend: reconstruct from DB + StateRepository (Redis); in-memory state lost | **OPEN** |
| 21 | Can admin manually correct results? | Post-competition editing | Recommend: P2 — post-MVP | **POSTPONED** |
| 22 | Category assignment — per participant or per competition? | U6/U8/U12 scope | Recommend: per participant (from import) | **PROPOSED** |
| 23 | PK scoring (Win=3, Draw=1, Loss=0) | Future PK implementation | Documented, not implemented | **POSTPONED** |

---

## 23. Feature Priority Matrix

| Feature | Requirement | Existing State | Action | Owner | Priority | Dependency | Target Date | Definition of Done |
|---------|-------------|---------------|--------|-------|----------|------------|-------------|-------------------|
| Multi-tenancy (organizations) | §4 | None | NEW | Sylvain | P0 | — | Day 1-2 | Orgs created; org_id on users/tournaments; tenantGuard middleware |
| Organization admin registration | §6 | Flat user model | MODIFY | Louise | P0 | Multi-tenancy | Day 2 | Register creates org+user; login returns org-scoped JWT |
| Competition-specific auth | §9 | None | NEW | Louise | P0 | Multi-tenancy | Day 3 | Judge/player login via /competition/{id}; competition JWT |
| Stage model + StageManager | §17-19 | No stages | NEW | Sylvain | P0 | Multi-tenancy | Day 3-5 | Stages configurable; auto-progression works; preparation/transition states |
| Competition entry point | §11 | None | NEW | Louise | P0 | Competition auth | Day 4 | /competition/{id} page; login; role routing |
| Individual round types | §17-19 | Team only | NEW | Sylvain | P0 | Stage model | Day 5-7 | Individual puzzles solvable; completion-ratio scoring |
| Completion-ratio scoring | §27-28 | Team scoring only | NEW | Sylvain | P0 | Stage model | Day 6-7 | Server-side scoring; integer results; correct for all edge cases |
| Player auto-save | §29 | Partial (R2 grid) | MODIFY | Louise | P0 | Stage model | Day 5-6 | Every cell change persisted; survives refresh/disconnect |
| Dashboard UI | §15 | Tournament list | MODIFY | Louise | P0 | Multi-tenancy | Day 3-4 | Navigation; competition list; settings |
| Excel participant import | §21 | Working | MODIFY | Louise | P0 | Multi-tenancy | Day 4-5 | Import with org_id; credential generation; team assignment |
| Judge creation | §23 | Manual team assignment | MODIFY | Louise | P1 | Multi-tenancy | Day 5 | Create judge; generate credentials; assign to competition |
| Puzzle bank (org-scoped) | §24 | Global puzzle bank | MODIFY | Louise | P | Multi-tenancy | Day 4-5 | Org-scoped bank; filter by round compatibility; assign to rounds |
| PDF import pipeline | §25-26 | None | NEW | Louise | P1 | Puzzle bank | Day 8-9 | PDF → structured puzzles → bank (basic extraction) |
| Auto round progression | §32-33 | Manual start | MODIFY | Sylvain | P0 | Stage model | Day 5-6 | Rounds auto-start after preparation; auto-transition between rounds |
| Preparation/transition screens | §33 | None | NEW | Louise | P0 | Auto progression | Day 7 | Rules display; countdown; auto-start |
| Judge participant monitoring | §35 | Room status only | MODIFY | Sylvain | P1 | WebSocket | Day 8-9 | Participant list; status; hover card; live view |
| Big-screen connection | §12-14 | None | NEW | Sylvain | P0 | WebSocket | Day 7-8 | Token generation; display page; WebSocket connection |
| Big-screen display modes | §37 | None | NEW | Sylvain | P1 | Big-screen connection | Day 9-10 | Default; ranking; player broadcast; round/final ranking |
| Real-time ranking | §38 | Query-based | MODIFY | Sylvain | P1 | Scoring | Day 9 | Live ranking updates during round; server-calculated |
| Category ranking | §40 | None | NEW | Louise | P1 | Scoring | Day 10 | U6/U8/U12 rankings per stage |
| Security headers | §62 | None | NEW | Louise | P0 | — | Day 2 | Helmet.js configured; appropriate headers set |
| Input validation | §48 | Manual | NEW | Louise | P0 | — | Day 2-3 | Zod schemas on all endpoints |
| Rate limiting | §51 | Login only | MODIFY | Louise | P0 | — | Day 2 | Appropriate limits on all sensitive endpoints |
| Tenant isolation tests | §47 | None | NEW | Both | P0 | Multi-tenancy | Day 4-5 | All cross-tenant access attempts blocked |
| WebSocket authorization | §56 | Partial | MODIFY | Sylvain | P0 | Competition auth | Day 6 | Role-checked events; competition-scoped subscriptions |
| Test suite | §66 | None | NEW | Both | P0 | — | Day 4-14 | Auth, isolation, lifecycle, scoring, security tests |
| Super Admin interface | §5.1 | None | NEW | Louise | P2 | Multi-tenancy | Day 11 | Minimal: view orgs, view competitions |
| PK stage structure | §43 | None | POSTPONE | — | P3 | — | Post-MVP | Stage type exists in DB; no gameplay |
| Payment/subscription | §3 | None | POSTPONE | — | P3 | — | Post-MVP | — |

---

## 24. Critical Path

```
Day 1: Multi-tenancy schema + tenantGuard
   ↓
Day 2-3: Organization auth + competition-specific auth + security basics
   ↓
Day 3-5: Stage model + StageManager + auto-progression
   ↓
Day 5-7: Individual round types + completion-ratio scoring + player auto-save
   ↓
Day 7-8: Big-screen connection + preparation/transition screens
   ↓
Day 8-10: Judge monitoring + display modes + real-time ranking
   ↓
Day 10-11: Category ranking + PDF import
   ↓
Day 11-13: Security hardening + comprehensive testing
   ↓
Day 13-14: Integration testing + bug fixing + stabilization
```

**Critical bottleneck:** Stage model + StageManager (Days 3-5). Everything else depends on the competition lifecycle being stage-aware. This must be stable before individual rounds, big-screen, or judge monitoring can proceed.

**Parallelizable work:**
- Security headers + input validation (Louise, Day 2) can run parallel to schema work (Sylvain, Day 1-2)
- Dashboard UI (Louise, Day 3-4) can run parallel to StageManager (Sylvain, Day 3-5)
- PDF import (Louise, Day 8-9) can run parallel to judge monitoring (Sylvain, Day 8-9)

---

## 25. 14-Day Schedule

---

### Day 1 — August 5, 2026

#### Objective
Establish the multi-tenant foundation: organizations table, org_id on core tables, tenant isolation middleware, and development environment setup.

#### Sylvain
- [ ] Create `organizations` table migration in `db.js` (id, name, slug, plan, timestamps)
- [ ] Add `organization_id` column to `users` table with FK to organizations
- [ ] Add `organization_id` column to `tournaments` table with FK to organizations
- [ ] Add `organization_id` column to `participants` table with FK to organizations
- [ ] Add `identifier` (UNIQUE TEXT) and `category` columns to `tournaments`
- [ ] Add `user_type` column to `users` (SUPER_ADMIN, ORG_USER, COMPETITION_JUDGE, COMPETITION_PLAYER)
- [ ] Create `tenantGuard.js` middleware: extracts org_id from JWT, verifies resource ownership
- [ ] Write unit tests for tenantGuard: org A user blocked from org B resources
- [ ] Update `config.js` to require JWT_SECRET (remove dev default)

#### Louise
- [ ] Add Helmet.js to server dependencies and configure in `index.js`
- [ ] Configure security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy)
- [ ] Install Zod for input validation
- [ ] Create validation schemas for: login, register, create tournament
- [ ] Add `validate.js` middleware that applies Zod schemas to routes
- [ ] Apply validation to `POST /api/auth/login` and `POST /api/auth/register`
- [ ] Add rate limiting to registration endpoint (5 req / 15 min)
- [ ] Review and restrict CORS configuration for production
- [ ] Remove demo.html from repo root (archive or delete)
- [ ] Remove quick-login buttons from LoginPage.jsx

#### Dependencies
- None (day 1 — foundation work)

#### Integration
- Both developers verify server starts with new schema
- Verify existing tests (if any) still pass

#### Testing
- [ ] Tenant guard blocks cross-org access
- [ ] Security headers present in responses
- [ ] Input validation rejects malformed requests

#### Definition of Done
- organizations table exists in database
- users, tournaments, participants have organization_id
- tenantGuard middleware blocks cross-org access
- Security headers present on all responses
- Server starts without errors

#### Risks
- Migration conflicts with existing `CREATE TABLE IF NOT EXISTS` pattern — may need to switch to proper migrations
- Existing seed data (admin/judge/player users) needs organization_id

---

### Day 2 — August 6, 2026

#### Objective
Organization admin registration/login flow working. Competition-specific auth designed. Input validation expanded.

#### Sylvain
- [ ] Implement `POST /api/auth/register` — creates organization + admin user atomically
- [ ] Update `POST /api/auth/login` to include organization_id in JWT payload
- [ ] Update JWT generation to include: userId, username, role, organizationId, userType
- [ ] Create `competitionAuth.js` middleware for competition-scoped authentication
- [ ] Design competition identifier generation (URL-safe slug from competition name + random suffix)
- [ ] Add `published` boolean to tournaments table
- [ ] Write tests for registration: creates org + user, returns valid JWT

#### Louise
- [ ] Extend rate limiting to all sensitive endpoints (file upload, competition entry, display token)
- [ ] Create validation schemas for: tournament CRUD, round creation, participant import, puzzle operations
- [ ] Apply validation middleware to all existing route files (auth, tournaments, rounds, teams, game, participants, puzzle-bank)
- [ ] Add MIME type validation to file upload (check magic bytes, not just extension)
- [ ] Add file content validation (verify XLSX structure before processing)
- [ ] Create validation schema for WebSocket messages (basic structure validation)
- [ ] Set up Vitest in client/ for frontend testing
- [ ] Set up Jest + Supertest in server/ for backend testing

#### Dependencies
- Day 1 multi-tenancy schema

#### Integration
- Register a test organization
- Login as org admin
- Verify JWT contains organization_id
- Verify existing endpoints reject invalid input

#### Testing
- [ ] Registration creates org + user in one transaction
- [ ] Login returns JWT with org_id
- [ ] Rate limiting blocks excessive requests
- [ ] File upload rejects non-XLSX content

#### Definition of Done
- Organization admin can register and login
- JWT includes organization context
- All API endpoints have input validation
- Rate limiting on all sensitive endpoints
- Test framework set up in both client and server

#### Risks
- Existing routes may break with strict validation — need careful schema design
- MIME type validation may reject valid XLSX files from different generators

---

### Day 3 — August 7, 2026

#### Objective
Competition-specific entry point working. Dashboard UI foundation. Stage database model created.

#### Sylvain
- [ ] Create `competition_stages` table migration
- [ ] Add `stage_id` column to `rounds` table
- [ ] Implement `POST /api/competitions/:identifier/login` — competition-scoped JWT
- [ ] Implement `GET /api/competitions/:identifier/info` — public competition info
- [ ] Create competition-scoped JWT: includes competitionId, role (JUDGE/PLAYER), participantId/judgeId, orgId
- [ ] Update `authMiddleware` to handle both org-scoped and competition-scoped JWTs
- [ ] Write tests for competition login: judge and player can authenticate

#### Louise
- [ ] Create `/competition/:identifier` route in React Router
- [ ] Build `CompetitionEntryPage.jsx` — displays competition name, login form, role detection
- [ ] Build `DashboardLayout.jsx` — sidebar navigation (Dashboard, Competitions, Puzzle Bank, Participants, Judges, Teams, Results)
- [ ] Create `/dashboard` route group with layout
- [ ] Migrate `TournamentListPage` content into `DashboardCompetitionsPage.jsx` (org-filtered)
- [ ] Create `DashboardPage.jsx` — org overview (competition count, upcoming competitions)
- [ ] Update `useAuth` hook to handle both org JWT and competition JWT

#### Dependencies
- Day 2 organization auth

#### Integration
- Create a competition via API
- Access /competition/{identifier}
- Login as judge → see competition info
- Access /dashboard → see org's competitions

#### Testing
- [ ] Competition login works for judges
- [ ] Competition login works for players
- [ ] Competition info endpoint returns public data
- [ ] Dashboard shows only org's competitions

#### Definition of Done
- Competition-specific login page at /competition/{identifier}
- Judge and player can authenticate for a specific competition
- Dashboard layout with navigation
- Stage table exists in database

#### Risks
- Two JWT types (org-scoped vs competition-scoped) add complexity to middleware
- Frontend needs to handle both auth contexts cleanly

---

### Day 4 — August 8, 2026

#### Objective
StageManager foundation. Participant import with org scoping. First integration checkpoint.

#### Sylvain
- [ ] Create `StageManager.js` in `server/src/engine/`
- [ ] Implement stage lifecycle states: WAITING → STAGE_STARTED → PREPARATION → ROUND_ACTIVE → ROUND_FINISHED → TRANSITION → (next round or STAGE_FINISHED)
- [ ] Implement `startStage(tournamentId, stageId)` — begins preparation phase
- [ ] Implement preparation phase: broadcast rules, start countdown (configurable 20-30s)
- [ ] Implement auto-transition: preparation ends → first round starts automatically
- [ ] Implement round end handler: round finishes → transition → next round auto-starts
- [ ] Implement stage completion: all rounds finished → STAGE_FINISHED
- [ ] Add WebSocket events: STAGE_STARTED, PREPARATION_STARTED, PREPARATION_COUNTDOWN, ROUND_AUTO_START, TRANSITION_STARTED
- [ ] Write tests for StageManager: full stage lifecycle with 3 rounds

#### Louise
- [ ] Update participant import to include organization_id
- [ ] Update `ParticipantImportService.js` to scope schools/participants to org
- [ ] Update participant credential generation: use random passwords instead of predictable pattern
- [ ] Create `POST /api/competitions/:id/judges` — create judge account scoped to competition
- [ ] Update judge credential generation: random password, competition-scoped user_type
- [ ] Build judge creation form in dashboard (name, email → generate credentials)
- [ ] Build credential display/export for judges
- [ ] Update participant list to show org-scoped data only

#### Dependencies
- Day 1-2 multi-tenancy + auth
- Day 3 stage table

#### Integration
- **CHECKPOINT 1:** Create org → register admin → create competition → add stages → import participants → generate credentials
- Verify tenant isolation: org A cannot see org B data

#### Testing
- [ ] StageManager transitions through all states correctly
- [ ] Auto-progression: preparation → round 1 → transition → round 2 → ...
- [ ] Participant import creates org-scoped records
- [ ] Judge creation generates competition-scoped credentials
- [ ] Tenant isolation: cross-org access blocked

#### Definition of Done
- StageManager handles full stage lifecycle
- Rounds auto-progress within a stage
- Participant import works with org scoping
- Judge creation with credential generation works
- Integration checkpoint 1 passes

#### Risks
- StageManager complexity — must handle concurrent events (timer expiry + judge end round)
- Migration of existing round data to include stage_id

---

### Day 5 — August 9, 2026

#### Objective
Auto round progression integrated with existing GameOrchestrator. Player auto-save for all round types.

#### Sylvain
- [ ] Integrate StageManager with existing GameOrchestrator
- [ ] Modify `startTournament` to accept stage_id and delegate to StageManager
- [ ] Remove manual `startRound` requirement (StageManager handles this)
- [ ] Keep manual `endRound` as judge override (early termination)
- [ ] Add `endRoundEarly()` to StageManager — judge can skip remaining time
- [ ] Implement `GET /api/competitions/:id/stages` — list stages with rounds
- [ ] Implement `PUT /api/competitions/:id/stages` — configure stage order and types
- [ ] Add API endpoint for judge to start a stage: `POST /api/competitions/:id/stages/:stageId/start`
- [ ] Write tests for integrated StageManager + GameOrchestrator

#### Louise
- [ ] Implement persistent auto-save for Round 1: save current_grid on every cell submission
- [ ] Implement persistent auto-save for Round 3: save shared puzzle state on every accepted proposal
- [ ] Update `player_puzzle_assignments.current_grid` on every meaningful action
- [ ] Add debounced save (max 1 write per second per player to avoid DB overload)
- [ ] Build `DashboardStagesPage.jsx` — stage configuration UI (add/remove stages, set types)
- [ ] Build round configuration within stages (duration, puzzle assignment)
- [ ] Update TournamentDetailPage to show stage-aware competition structure

#### Dependencies
- Day 4 StageManager

#### Integration
- Start a competition with one stage and 3 rounds
- Verify auto-progression through all rounds
- Verify player state persists across refresh

#### Testing
- [ ] Auto-progression: preparation → R1 → transition → R2 → transition → R3 → stage complete
- [ ] Judge can end round early → transition proceeds normally
- [ ] Player grid state survives browser refresh
- [ ] Debounced save doesn't overload database

#### Definition of Done
- GameOrchestrator delegates to StageManager for round progression
- Judge starts stage once; rounds auto-progress
- Player auto-save works for all round types
- Stage configuration UI functional

#### Risks
- Integration between StageManager and existing round engines may reveal assumptions
- Debounce timing needs tuning under load

---

### Day 6 — August 10, 2026

#### Objective
Individual round types defined. Completion-ratio scoring implemented. WebSocket authorization hardened.

#### Sylvain
- [ ] Define individual round types (consult Open Decision #1 — use placeholder types if unresolved)
- [ ] Create `CompletionScorer.js` in `server/src/engine/`
- [ ] Implement completion-ratio algorithm: compare initial_grid + solution + player_grid
- [ ] Count `totalOriginallyEmptyCells` from initial_grid
- [ ] Count `correctlyFilledCells` (player matches solution AND initial was empty)
- [ ] Calculate `completionRatio = correctly / total`
- [ ] Calculate `puzzleScore = Math.round(maxPoints * completionRatio)` (subject to Open Decision #5)
- [ ] Implement `POST /api/submissions/individual` — server-side scoring endpoint
- [ ] Add WebSocket role checks in SocketManager: players cannot emit judge events, judges cannot emit player events
- [ ] Write tests for CompletionScorer: 0%, 50%, 58.8%, 100% scenarios

#### Louise
- [ ] Create `PuzzleBankPage.jsx` refactored for org-scoped puzzle bank
- [ ] Build `DashboardPuzzleBankPage.jsx` with org-filtered puzzle list
- [ ] Add round-type compatibility filter to puzzle bank
- [ ] Implement puzzle assignment from bank to rounds (drag/select interface)
- [ ] Build puzzle preview modal with initial grid + solution display
- [ ] Add `puzzle_bank` table with organization_id scoping
- [ ] Update puzzle generation to store in puzzle_bank
- [ ] Write tests for puzzle bank: org-scoped listing, filter by round type

#### Dependencies
- Day 5 StageManager + auto-progression
- Day 3 stage model

#### Integration
- Score an individual puzzle using completion-ratio algorithm
- Verify WebSocket role checks block unauthorized events

#### Testing
- [ ] CompletionScorer: 0/51 = 0 points
- [ ] CompletionScorer: 30/51 ≈ Math.round(20 * 0.588) = 12 points (for 20-point puzzle)
- [ ] CompletionScorer: 51/51 = full points
- [ ] Pre-filled cells not counted
- [ ] Incorrect cells don't reduce score
- [ ] WebSocket role checks block player from judge events

#### Definition of Done
- CompletionScorer correctly calculates scores for all edge cases
- Individual scoring endpoint works server-side
- WebSocket events are role-filtered
- Puzzle bank is org-scoped with round-type filtering

#### Risks
- Individual round types undefined (Open Decision #1) — may need to create placeholder round types
- Puzzle bank migration from existing round-scoped puzzles to org-scoped bank

---

### Day 7 — August 11, 2026

#### Objective
Big-screen connection system. Preparation/transition player screens. **Milestone: Individual competition can run end-to-end.**

#### Sylvain
- [ ] Create `display_sessions` table migration
- [ ] Create `DisplayManager.js` in `server/src/ws/`
- [ ] Implement `POST /api/display/token` — generate temporary UUID token (5min TTL)
- [ ] Implement `GET /api/display/:token/validate` — validate token, return competition info
- [ ] Add display WebSocket auth: accept display token in handshake
- [ ] Create `display_{tournamentId}` room in SocketManager
- [ ] Implement display connection: validate token → join display room → mark CONNECTED
- [ ] Emit DISPLAY_CONNECTED event to judge
- [ ] Implement `PUT /api/display/mode` — judge changes display mode
- [ ] Emit DISPLAY_MODE_CHANGED to display room
- [ ] Write tests for display token lifecycle

#### Louise
- [ ] Build `PreparationScreen.jsx` — shows round rules, countdown timer, "Get Ready" message
- [ ] Build `TransitionScreen.jsx` — shows "Round X complete", brief results, countdown to next round
- [ ] Build `WaitingScreen.jsx` — "Waiting for judge to start..." message
- [ ] Integrate screens into `PlayerGamePage.jsx` — show correct screen based on competition state
- [ ] Build `DisplayPage.jsx` — big-screen renderer (default mode: competition info)
- [ ] Add `/display/:token` route in React Router
- [ ] Build judge "Connect Big Screen" button in JudgeControlPage
- [ ] Build token display modal (URL + Copy Link button)

#### Dependencies
- Day 5 auto-progression (for preparation/transition states)
- Day 3 competition entry point

#### Integration
- **CHECKPOINT 2:** First end-to-end individual competition flow
- Judge starts stage → preparation screen → round auto-starts → player plays → round ends → transition → next round

#### Testing
- [ ] Display token generates correctly
- [ ] Display page connects via WebSocket
- [ ] Judge can change display mode
- [ ] Preparation screen shows before round
- [ ] Transition screen shows between rounds

#### Definition of Done
- Big screen connects via temporary token URL
- Judge can control big-screen display mode
- Preparation and transition screens work for players
- Individual competition runs end-to-end (basic)

#### Risks
- Display token security — must not grant normal user privileges
- Preparation screen timing — must sync with server state exactly

---

### Day 8 — August 12, 2026

#### Objective
Judge participant monitoring. Big-screen ranking display. Live player view for judge.

#### Sylvain
- [ ] Implement `GET /api/competitions/:id/monitoring/participants` — participant list with live status
- [ ] Add participant online/offline tracking via existing heartbeat system
- [ ] Add `PARTICIPANT_STATE_UPDATE` WebSocket event (to judge room only)
- [ ] Implement `GET /api/competitions/:id/monitoring/player/:playerId` — player's current puzzle state
- [ ] Add `PLAYER_GRID_UPDATE` event — when player fills cell, judge monitoring them receives update
- [ ] Implement judge broadcast player: `PUT /api/display/broadcast/:playerId`
- [ ] Add `DISPLAY_PLAYER_BROADCAST` event to display room
- [ ] Build real-time ranking query: `GET /api/competitions/:id/ranking/live`
- [ ] Add `RANKING_UPDATE` WebSocket event (broadcast during active round)

#### Louise
- [ ] Build `JudgeMonitoringPanel.jsx` — participant grid/list with status indicators
- [ ] Add hover info card (name, school, age, category, status)
- [ ] Add click action: open player detail / broadcast to big screen
- [ ] Build `JudgeLivePlayerView.jsx` — shows selected player's puzzle state in real-time
- [ ] Build `DisplayRankingView.jsx` — big-screen ranking table (sortable, auto-updating)
- [ ] Build `DisplayPlayerBroadcastView.jsx` — big-screen shows player's puzzle grid
- [ ] Integrate display views into `DisplayPage.jsx` with mode switching
- [ ] Add judge "Broadcast Player" action in monitoring panel

#### Dependencies
- Day 7 big-screen connection
- Day 5 auto-progression

#### Integration
- Judge monitors participant list during active round
- Judge broadcasts a player to big screen
- Big screen switches between ranking and player broadcast

#### Testing
- [ ] Participant list shows correct online/offline status
- [ ] Judge sees live player grid updates
- [ ] Big screen displays ranking correctly
- [ ] Big screen shows broadcast player's grid

#### Definition of Done
- Judge can see all participants with live status
- Judge can view a player's puzzle state in real-time
- Judge can broadcast a player to the big screen
- Big screen displays live ranking and player broadcast

#### Risks
- Performance: broadcasting every cell change to judge + display may be high-frequency
- Need throttling on PLAYER_GRID_UPDATE events (max 2-3 per second per player)

---

### Day 9 — August 13, 2026

#### Objective
Real-time ranking system. Round results storage. PDF import pipeline (basic).

#### Sylvain
- [ ] Create `round_results` table migration
- [ ] Implement server-side ranking calculation after round ends
- [ ] Store per-puzzle, per-round results in `round_results` table
- [ ] Implement `GET /api/competitions/:id/ranking/round/:roundId` — round ranking
- [ ] Implement `GET /api/competitions/:id/ranking/stage/:stageId` — stage ranking (aggregate)
- [ ] Implement `GET /api/competitions/:id/ranking/final` — final competition ranking
- [ ] Add ranking events to WebSocket: ROUND_RANKING, STAGE_RANKING, FINAL_RANKING
- [ ] Build `DisplayRoundRankingView.jsx` data provider
- [ ] Build `DisplayFinalRankingView.jsx` data provider
- [ ] Write tests for ranking: correct ordering, tiebreaking by time

#### Louise
- [ ] Install PDF parsing library (pdf-parse or pdfjs-dist)
- [ ] Create `PdfImportService.js` — basic PDF text extraction
- [ ] Implement PDF → structured puzzle data pipeline:
  - Extract text content from PDF
  - Parse grid patterns (9x9 number grids)
  - Identify puzzle boundaries (initial state vs solution)
  - Extract point values if present
- [ ] Implement `POST /api/puzzle-bank/import-pdf` endpoint
- [ ] Add file validation: PDF MIME type, size limit (20MB)
- [ ] Build PDF import UI in DashboardPuzzleBankPage (upload, preview, confirm)
- [ ] Handle extraction errors gracefully (show which pages failed)
- [ ] Write tests for PDF import: valid PDF produces correct puzzle structures

#### Dependencies
- Day 6 completion-ratio scoring
- Day 7 big-screen

#### Integration
- Round ends → scores calculated → results stored → ranking displayed
- PDF upload → puzzles extracted → added to bank

#### Testing
- [ ] Round results stored correctly for all participants
- [ ] Ranking ordered by score DESC, time ASC
- [ ] Stage ranking aggregates round scores correctly
- [ ] PDF import extracts puzzles from sample PDF

#### Definition of Done
- Round results persisted in database
- Server-side ranking calculation works
- Big screen can display round and final rankings
- Basic PDF import pipeline functional (may need tuning with actual PDFs)

#### Risks
- PDF format unknown (Open Decision #9) — basic extraction may not work with actual competition PDFs
- Ranking calculation performance with many participants

---

### Day 10 — August 14, 2026

#### Objective
Category ranking (U6/U8/U12). Team competition integration with stages. Puzzle bank assignment workflow.

#### Sylvain
- [ ] Implement category-filtered ranking queries (filter by participant category)
- [ ] Add category parameter to all ranking endpoints
- [ ] Build category ranking display for big screen (selectable U6/U8/U12)
- [ ] Integrate existing team round engines (R1/R2/R3) with StageManager
- [ ] Verify team rounds work within TEAM stage context
- [ ] Add stage_type check: individual rounds only in INDIVIDUAL stage, team rounds only in TEAM stage
- [ ] Implement team auto-generation from participant school/group data
- [ ] Write tests for category ranking and team stage integration

#### Louise
- [ ] Build category selection in ranking display (dropdown: All, U6, U8, U12)
- [ ] Build `DashboardResultsPage.jsx` — view historical competition results
- [ ] Display round-by-round results with expandable detail
- [ ] Show individual and team rankings side by side
- [ ] Build puzzle-to-round assignment interface (select puzzles from bank → assign to specific round)
- [ ] Add round-type compatibility check: prevent assigning incompatible puzzles
- [ ] Build competition publish workflow: validate all rounds have puzzles → enable publish button
- [ ] Implement `POST /api/competitions/:id/publish` endpoint

#### Dependencies
- Day 9 ranking system
- Day 5 StageManager

#### Integration
- **CHECKPOINT 3:** Team competition integration
- Run a competition with both INDIVIDUAL and TEAM stages
- Category rankings display correctly

#### Testing
- [ ] Category ranking filters correctly (U6 players only in U6 ranking)
- [ ] Team rounds work within TEAM stage
- [ ] Individual rounds work within INDIVIDUAL stage
- [ ] Puzzle assignment enforces round-type compatibility
- [ ] Published competition cannot have unconfigured rounds

#### Definition of Done
- Category rankings (U6/U8/U12) work for individual and team
- Team competition runs within TEAM stage using existing R1/R2/R3 engines
- Puzzle bank assignment workflow complete
- Competition publish validation works

#### Risks
- Integrating existing team round engines with new StageManager may require refactoring
- Team auto-generation rules may need clarification

---

### Day 11 — August 15, 2026

#### Objective
Super Admin interface (minimal). Security hardening pass. WebSocket security review.

#### Sylvain
- [ ] Create Super Admin role check middleware (user_type = SUPER_ADMIN)
- [ ] Implement `POST /api/admin/login` — Super Admin authentication
- [ ] Implement `GET /api/admin/organizations` — list all organizations
- [ ] Implement `GET /api/admin/competitions` — list all competitions across orgs
- [ ] Implement `GET /api/admin/stats` — platform statistics (org count, competition count, user count)
- [ ] Review WebSocket authorization: verify all events check role + competition membership
- [ ] Add WebSocket message rate limiting (max events per second per connection)
- [ ] Add WebSocket connection limiting (max connections per user)
- [ ] Review and fix race conditions: judge endRound + timer expiry concurrent

#### Louise
- [ ] Build Super Admin login page at `/admin/login`
- [ ] Build `AdminDashboardPage.jsx` — org list, competition list, platform stats
- [ ] Add `/admin/*` route group with Super Admin auth guard
- [ ] Review all server error responses: ensure no stack traces or internal paths exposed
- [ ] Add structured logging (install Winston or Pino)
- [ ] Configure log levels: ERROR for production, DEBUG for development
- [ ] Add logging for: auth failures, competition state changes, display connections, file upload attempts
- [ ] Review all database queries for SQL injection (verify parameterized queries everywhere)
- [ ] Ensure `.env` file is in `.gitignore` and credentials are rotated

#### Dependencies
- All previous days

#### Integration
- Super Admin can view all organizations and competitions
- Security review reveals no critical vulnerabilities

#### Testing
- [ ] Super Admin login works; non-SUPER_ADMIN users blocked
- [ ] WebSocket rate limiting blocks spam
- [ ] No stack traces in error responses
- [ ] Structured logging captures important events

#### Definition of Done
- Super Admin interface functional (minimal)
- WebSocket security hardened
- Structured logging in place
- No error information disclosure

#### Risks
- WebSocket rate limiting may affect legitimate high-frequency game events
- Need to balance security with gameplay responsiveness

---

### Day 12 — August 16, 2026

#### Objective
Comprehensive security testing. Failure/recovery scenarios. Performance review.

#### Sylvain
- [ ] Write security test suite:
  - [ ] Cross-tenant access attempts (REST + WebSocket)
  - [ ] Role escalation attempts (player accessing judge APIs)
  - [ ] Invalid/expired token handling
  - [ ] Malicious WebSocket subscriptions
  - [ ] SQL injection in all parameterized endpoints
- [ ] Implement failure recovery:
  - [ ] Player disconnect during round: preserve last auto-saved state
  - [ ] Judge disconnect: server continues timer, round auto-ends on expiry
  - [ ] Big screen disconnect: auto-reconnect if session not expired
- [ ] Add idempotency to competition state transitions (prevent double-start)
- [ ] Review and optimize database queries (check for N+1 patterns)
- [ ] Add connection pool monitoring

#### Louise
- [ ] Write security test suite:
  - [ ] Malicious file upload (wrong MIME, oversized, path traversal)
  - [ ] XSS prevention in competition names, participant names
  - [ ] CSRF protection review (JWT mitigates most, verify WebSocket)
  - [ ] Rate limiting effectiveness test
- [ ] Implement file upload improvements:
  - [ ] Path traversal prevention in filenames
  - [ ] Temporary file cleanup after processing
  - [ ] Content-Type header correctness on responses
- [ ] Build comprehensive error boundary components in React
- [ ] Add user-friendly error pages (404, 403, 500)
- [ ] Test and fix all loading states and error states across pages

#### Dependencies
- All previous days

#### Integration
- **CHECKPOINT 4:** Security audit pass
- All critical security tests pass
- Failure recovery works for player/judge/display disconnects

#### Testing
- [ ] All security tests pass
- [ ] Player disconnect → state preserved → score calculated normally
- [ ] Judge disconnect → round auto-ends on timer
- [ ] Big screen reconnects within token TTL
- [ ] No N+1 query patterns in critical paths

#### Definition of Done
- Security test suite comprehensive and passing
- Failure/recovery scenarios handled
- Performance bottlenecks identified and addressed
- Error boundaries in place

#### Risks
- Security fixes may reveal additional issues requiring more time
- Performance optimization may be premature (mark as P2 if time-constrained)

---

### Day 13 — August 17, 2026

#### Objective
Full competition simulation. End-to-end integration testing. Bug fixing.

#### Sylvain
- [ ] Run full end-to-end competition simulation:
  1. Register org → create competition → configure INDIVIDUAL + TEAM stages
  2. Import participants → generate credentials
  3. Create judges → generate credentials
  4. Import puzzles → assign to rounds
  5. Publish competition
  6. Players and judges log in via competition entry
  7. Big screen connects
  8. Judge starts INDIVIDUAL stage → rounds auto-progress
  9. Judge monitors players → broadcasts to big screen
  10. INDIVIDUAL stage completes → rankings generated
  11. Judge starts TEAM stage → team rounds execute
  12. TEAM stage completes → final rankings
  13. Admin views results
- [ ] Document all bugs found during simulation
- [ ] Fix critical bugs (P0 only)
- [ ] Verify all WebSocket events flow correctly through full lifecycle

#### Louise
- [ ] Write E2E test scripts for critical paths (using Supertest for API + manual UI verification)
- [ ] Test participant import with various Excel formats and edge cases
- [ ] Test credential export format is usable for distribution
- [ ] Verify all dashboard pages render correctly with data
- [ ] Test competition publish validation catches all incomplete configurations
- [ ] Test big-screen display in all modes
- [ ] Test preparation/transition screens timing accuracy
- [ ] Document all bugs found during testing
- [ ] Fix P0/P1 bugs

#### Dependencies
- All previous days

#### Integration
- **CHECKPOINT 5:** Full competition simulation passes
- All 40 steps from the end-to-end scenario (§67) work

#### Testing
- [ ] Full 40-step end-to-end scenario passes without critical failures
- [ ] All P0 bugs fixed
- [ ] P1 bugs documented and prioritized

#### Definition of Done
- Complete competition can be run from registration to final ranking
- All critical paths tested and working
- P0 bugs fixed
- Remaining P1 bugs documented

#### Risks
- Integration issues between independently developed features
- May discover P0 bugs that require significant rework

---

### Day 14 — August 18, 2026

#### Objective
Final stabilization. Documentation. Deployment preparation. MVP validation.

#### Sylvain
- [ ] Fix remaining P1 bugs from Day 13
- [ ] Final security review: verify no critical cross-tenant vulnerabilities
- [ ] Verify all database migrations are idempotent and reproducible
- [ ] Test server restart recovery (start competition → restart server → verify state)
- [ ] Update deployment scripts for new database schema
- [ ] Verify production environment configuration
- [ ] Create database backup/restore procedure documentation

#### Louise
- [ ] Fix remaining P1 bugs from Day 13
- [ ] Final UI review: all pages render correctly, no broken layouts
- [ ] Verify all error messages are user-friendly (no technical jargon)
- [ ] Update FRONTEND_DOCUMENTATION.md and BACKEND_DOCUMENTATION.md
- [ ] Create user guide for organization admin (competition setup walkthrough)
- [ ] Create judge quick-start guide (how to run a competition)
- [ ] Final accessibility review (keyboard navigation, screen reader basics)

#### Dependencies
- Day 13 bug fixes

#### Integration
- **FINAL CHECKPOINT:** MVP Definition of Done validation
- Run through complete MVP checklist (Section 31)
- Sign off on MVP readiness

#### Testing
- [ ] All MVP Definition of Done criteria met
- [ ] No P0 or critical P1 bugs remaining
- [ ] Documentation complete and accurate
- [ ] Deployment verified

#### Definition of Done
- MVP is demonstration-ready
- Complete competition flow works end-to-end
- Documentation updated
- Deployment scripts tested
- No critical security vulnerabilities

#### Risks
- Time pressure: if Day 13 found many bugs, Day 14 may not be enough to fix them all
- Contingency: defer non-critical P1 bugs to post-MVP sprint

---

## 26. Sylvain Responsibilities

**Primary domain:** Competition lifecycle engine, real-time systems, scoring, big-screen backend, security infrastructure

| Day | Focus Area |
|-----|-----------|
| 1 | Multi-tenancy schema, tenantGuard middleware, JWT updates |
| 2 | Organization registration, competition-scoped auth design |
| 3 | Competition-specific login, stage table |
| 4 | StageManager foundation, stage lifecycle |
| 5 | StageManager + GameOrchestrator integration, auto-progression |
| 6 | Completion-ratio scoring, WebSocket role enforcement |
| 7 | Big-screen connection system, DisplayManager |
| 8 | Judge participant monitoring, live player view, real-time ranking |
| 9 | Round results storage, ranking calculation |
| 10 | Category ranking, team stage integration |
| 11 | Super Admin backend, WebSocket security hardening |
| 12 | Security test suite, failure recovery, performance |
| 13 | Full competition simulation, bug fixing |
| 14 | Final stabilization, deployment, MVP validation |

---

## 27. Louise Responsibilities

**Primary domain:** Admin dashboard, participant/judge management, puzzle bank, PDF import, frontend UI, input validation, documentation

| Day | Focus Area |
|-----|-----------|
| 1 | Security headers (Helmet), input validation (Zod), rate limiting |
| 2 | Extended validation, rate limiting, test framework setup |
| 3 | Competition entry page, dashboard layout, auth hook updates |
| 4 | Participant import with org scoping, judge creation |
| 5 | Player auto-save persistence, stage configuration UI |
| 6 | Org-scoped puzzle bank, puzzle assignment workflow |
| 7 | Preparation/transition/waiting screens, display page |
| 8 | Judge monitoring panel UI, display mode views |
| 9 | PDF import pipeline, ranking display views |
| 10 | Category ranking UI, results page, publish workflow |
| 11 | Super Admin frontend, structured logging, error handling review |
| 12 | Security test suite (frontend), error boundaries, upload hardening |
| 13 | E2E testing, credential export testing, bug fixing |
| 14 | Documentation updates, user guides, final UI review |

---

## 28. Daily Definitions of Done

| Day | Must Be True at End of Day |
|-----|---------------------------|
| 1 | Org table exists; tenantGuard blocks cross-org access; security headers on all responses; server starts |
| 2 | Org admin registers + logs in; JWT has org_id; all endpoints validated; rate limiting active; test frameworks installed |
| 3 | Competition entry page works; dashboard layout navigable; competition-scoped JWT issued; stage table exists |
| 4 | StageManager transitions through all states; participants imported with org_id; judges created; tenant isolation verified |
| 5 | Rounds auto-progress within stage; player auto-save persists; stage config UI functional; GameOrchestrator integrated |
| 6 | Completion-ratio scoring correct for all edge cases; WebSocket role-filtered; puzzle bank org-scoped with filtering |
| 7 | Big screen connects via token URL; judge controls display mode; preparation/transition screens shown; individual comp runs end-to-end |
| 8 | Judge monitors participants with live status; live player view works; big screen shows ranking + player broadcast |
| 9 | Round results stored; server-side ranking calculated; PDF import pipeline functional (basic) |
| 10 | Category rankings work; team stage integrates with StageManager; puzzle assignment enforces compatibility; publish validates |
| 11 | Super Admin interface functional; WebSocket hardened; structured logging active; no error disclosure |
| 12 | Security tests pass; disconnect recovery works; error boundaries in place; performance acceptable |
| 13 | Full 40-step competition simulation passes; P0 bugs fixed; remaining bugs documented |
| 14 | MVP checklist complete; documentation updated; deployment verified; demonstration-ready |

---

## 29. Integration Checkpoints

### Checkpoint 1 — Day 4: Foundation Integration
**Must work:**
- Organization admin registers → org created → admin logs in → JWT has org_id
- Admin creates competition → competition appears in dashboard
- Admin imports participants → credentials generated → org-scoped
- Admin creates judge → credentials generated → competition-scoped
- Tenant isolation: org A cannot access org B data via API

### Checkpoint 2 — Day 7: First End-to-End Flow
**Must work:**
- Competition published
- Player logs in via /competition/{id} → sees waiting screen
- Judge logs in via /competition/{id} → sees control panel
- Judge starts stage → preparation screen → round auto-starts
- Player solves puzzle → auto-saved → scored on round end
- Rounds auto-progress through stage
- Big screen connects and shows default view

### Checkpoint 3 — Day 10: Real-Time + Team Integration
**Must work:**
- Judge monitors all participants with live status
- Judge broadcasts player to big screen
- Big screen shows live ranking during round
- Team competition runs within TEAM stage (R1/R2/R3)
- Category rankings display correctly
- Individual + Team stages in same competition

### Checkpoint 4 — Day 12: Security + Recovery
**Must work:**
- All security tests pass
- No cross-tenant access possible
- Player disconnect → state preserved
- Judge disconnect → round auto-ends
- Big screen reconnects
- Rate limiting blocks abuse

### Checkpoint 5 — Day 13: Full Competition Simulation
**Must work:**
- Complete 40-step end-to-end scenario (§67) passes
- All roles can complete their workflows
- All results stored and accessible
- No critical bugs

---

## 30. Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|-----------|-------|
| PDF format unknown — basic extraction may fail | High | Medium | Build simplest pipeline first; mark as P1; accept manual puzzle entry as fallback | Louise |
| Individual round types undefined (Open Decision #1) | Medium | High | Use placeholder round types; design flexible enough to adapt; escalate decision by Day 5 | Sylvain |
| StageManager complexity — concurrent events | Medium | High | Implement state machine with explicit guards; write comprehensive tests early | Sylvain |
| Existing team round engines incompatible with StageManager | Low | High | Inspect integration points on Day 10; refactor if needed; fallback: manual round start for team stage | Sylvain |
| Integration conflicts between parallel work | Medium | Medium | Daily standup; integration checkpoints every 3 days; merge to main daily | Both |
| AI-generated code inconsistencies | Medium | Medium | Code review before merge; consistent patterns documented; naming conventions enforced | Both |
| Database migration failures on existing data | Medium | High | Test migrations against seeded database; backup before migration; rollback plan | Sylvain |
| WebSocket performance under load | Low | Medium | Throttle high-frequency events; batch ranking updates; limit broadcast recipients | Sylvain |
| Timer synchronization across clients | Low | Medium | Server-authoritative model already in place; 10s recalibration sufficient | Sylvain |
| Participant disconnection during round | Medium | Low | Auto-save preserves state; server scores on round end regardless | Sylvain |
| Big-screen token security bypass | Low | High | Token is single-use, short-lived, display-only; no user privileges | Sylvain |
| Scoring rounding dispute | Low | Medium | Default to Math.round per puzzle; escalate as product decision by Day 6 | Sylvain |
| Team auto-generation rules unclear | Medium | Medium | Use existing school/group logic from participant import; clarify with product | Louise |
| Existing N+1 queries degrade performance | Medium | Low | Identify in Day 12 performance review; add JOINs where needed | Sylvain |
| Credential export format not usable | Low | Low | Test with actual Excel; adjust format if needed | Louise |
| Server restart during competition loses in-memory state | Medium | High | Use Redis StateRepository in production; document limitation; manual recovery procedure | Sylvain |

---

## 31. MVP Definition of Done

The MVP is complete when ALL of the following are true:

### Authentication & Authorization
- [ ] Organization admin can register (creates org + user)
- [ ] Organization admin can login (JWT with org_id)
- [ ] Organization data is isolated (tenant guard on all queries)
- [ ] Judges and players login via competition-specific entry point
- [ ] Super Admin has minimal management interface
- [ ] Role-based access enforced on backend (not just frontend)

### Competition Configuration
- [ ] Admin can create a competition
- [ ] Admin can select/configure stages (INDIVIDUAL, TEAM)
- [ ] Admin can configure rounds within each stage
- [ ] Admin can assign puzzles from puzzle bank to rounds
- [ ] Competition can be published (with validation)

### Participant & Judge Management
- [ ] Admin can import participants via Excel
- [ ] Participant credentials are auto-generated
- [ ] Admin can export credentials for distribution
- [ ] Admin can create judges for a competition
- [ ] Judge credentials are auto-generated

### Competition Execution
- [ ] Players can enter the competition via /competition/{id}
- [ ] Judges can enter the competition via /competition/{id}
- [ ] Judge can start a stage
- [ ] Preparation screen shows before round
- [ ] Rounds start automatically after preparation
- [ ] Timer works (server-authoritative)
- [ ] Player progress auto-saves to server
- [ ] Round can end automatically (timer expiry)
- [ ] Judge can end round early
- [ ] Auto-transition between rounds within a stage
- [ ] Stage completes when all rounds finish
- [ ] Next stage can be started

### Scoring & Ranking
- [ ] Server-side scoring using completion-ratio algorithm
- [ ] Scores are integers per explicit rounding policy
- [ ] Round rankings calculated
- [ ] Stage rankings aggregated
- [ ] Category rankings (U6/U8/U12) available
- [ ] Round results stored for historical access

### Big Screen
- [ ] Big screen connects via temporary token URL
- [ ] Judge can control big-screen display mode
- [ ] Big screen displays live ranking
- [ ] Big screen displays selected player's state
- [ ] Big screen displays round/final rankings

### Team Competition
- [ ] Team stage uses existing R1/R2/R3 round engines
- [ ] Teams auto-generated from participant data
- [ ] Team rankings separate from individual rankings

### Security
- [ ] Security headers configured (Helmet)
- [ ] Input validation on all endpoints
- [ ] Rate limiting on sensitive endpoints
- [ ] No critical cross-tenant authorization vulnerability
- [ ] No critical data-loss issue
- [ ] WebSocket authorization enforced

### Quality
- [ ] Critical end-to-end tests pass
- [ ] Full 40-step competition simulation passes
- [ ] No P0 bugs remaining
- [ ] Documentation updated

---

## 32. Post-MVP Roadmap

### Sprint 1 (Week 3-4): Stabilization
- Fix remaining P1 bugs
- Performance optimization (query optimization, WebSocket batching)
- PDF import tuning (adapt to actual competition PDF format)
- Expanded test coverage
- PK stage structural foundation

### Sprint 2 (Month 2): Enhanced Features
- Full PK competition gameplay (Win=3, Draw=1, Loss=0)
- Advanced judge analytics
- Competition templates (pre-configured competition setups)
- Participant self-service (password reset, profile)
- Advanced puzzle bank (tagging, difficulty auto-detection)

### Sprint 3 (Month 3): SaaS Features
- Subscription/payment integration
- Automated tenant provisioning
- Usage-based billing
- Organization settings (branding, custom domains)
- Multi-language support expansion

### Sprint 4 (Month 4+): Scale & Enterprise
- Redis adapter for horizontal WebSocket scaling
- Competition replay/recording
- Advanced analytics dashboard
- API for third-party integrations
- Enterprise audit logging
- White-label deployment support

---

## Appendix A: File Change Summary

### New Files to Create

| File | Purpose | Owner |
|------|---------|-------|
| `server/src/middleware/tenantGuard.js` | Tenant isolation enforcement | Sylvain |
| `server/src/middleware/competitionAuth.js` | Competition-scoped JWT | Sylvain |
| `server/src/middleware/validate.js` | Zod validation middleware | Louise |
| `server/src/engine/StageManager.js` | Stage lifecycle + auto-progression | Sylvain |
| `server/src/engine/CompletionScorer.js` | Completion-ratio scoring | Sylvain |
| `server/src/ws/DisplayManager.js` | Big-screen connection + control | Sylvain |
| `server/src/services/PdfImportService.js` | PDF extraction pipeline | Louise |
| `server/src/validations/*.js` | Zod schemas per route | Louise |
| `client/src/pages/CompetitionEntryPage.jsx` | Competition login | Louise |
| `client/src/pages/DisplayPage.jsx` | Big-screen renderer | Louise |
| `client/src/pages/PreparationScreen.jsx` | Pre-round rules + countdown | Louise |
| `client/src/pages/TransitionScreen.jsx` | Between-round screen | Louise |
| `client/src/pages/WaitingScreen.jsx` | Pre-competition waiting | Louise |
| `client/src/pages/dashboard/*.jsx` | Dashboard pages (5+) | Louise |
| `client/src/pages/admin/*.jsx` | Super Admin pages | Louise |
| `client/src/components/JudgeMonitoringPanel.jsx` | Participant monitoring | Louise |
| `client/src/components/JudgeLivePlayerView.jsx` | Live player state | Louise |
| `server/tests/**/*.test.js` | Backend test suite | Both |
| `client/tests/**/*.test.jsx` | Frontend test suite | Louise |

### Files to Modify

| File | Change | Owner |
|------|--------|-------|
| `server/src/utils/db.js` | Add new tables, alter existing | Sylvain |
| `server/src/middleware/auth.js` | Add org context, dual JWT support | Sylvain |
| `server/src/engine/GameOrchestrator.js` | Integrate StageManager | Sylvain |
| `server/src/ws/SocketManager.js` | Display rooms, role filtering | Sylvain |
| `server/src/index.js` | Helmet, new routes, middleware | Louise |
| `server/src/routes/*.js` | Add validation, org scoping | Both |
| `server/src/config.js` | Require JWT_SECRET | Sylvain |
| `client/src/App.jsx` | New routes (dashboard, competition, display, admin) | Louise |
| `client/src/hooks/useAuth.jsx` | Dual JWT support | Louise |
| `client/src/hooks/useGameSocket.js` | Stage events, display events | Sylvain |
| `client/src/pages/PlayerGamePage.jsx` | Integrate prep/transition screens | Louise |
| `client/src/pages/JudgeControlPage.jsx` | Stage-aware controls, monitoring | Both |

---

## Appendix B: Database Migration Order

1. `organizations` table (new)
2. `users` — add `organization_id`, `user_type`
3. `tournaments` — add `organization_id`, `identifier`, `category`, `published`
4. `participants` — add `organization_id`
5. `competition_stages` table (new)
6. `rounds` — add `stage_id`
7. `puzzle_bank` table (new)
8. `puzzles` — add `puzzle_bank_id`, `initial_empty_cells`
9. `round_results` table (new)
10. `display_sessions` table (new)

Each migration must be idempotent and include rollback instructions.

---

## Appendix C: WebSocket Event Registry

### New Events (Server → Client)

| Event | Target | Payload | Description |
|-------|--------|---------|-------------|
| STAGE_STARTED | competition room | {stageId, stageType} | Stage begins |
| PREPARATION_STARTED | competition room | {stageId, roundId, rules, countdownSeconds} | Preparation phase |
| PREPARATION_COUNTDOWN | competition room | {secondsRemaining} | Countdown tick |
| ROUND_AUTO_START | competition room | {roundId, roundNumber, duration} | Round auto-started |
| TRANSITION_STARTED | competition room | {nextRoundId, countdownSeconds, lastRoundSummary} | Transition phase |
| STAGE_FINISHED | competition room | {stageId, stageResults} | Stage complete |
| DISPLAY_CONNECTED | judge user room | {displayId, status} | Big screen connected |
| DISPLAY_MODE_CHANGED | display room | {mode, data} | Display mode updated |
| DISPLAY_PLAYER_BROADCAST | display room | {playerId, grid, puzzleId} | Player state broadcast |
| PARTICIPANT_STATE_UPDATE | judge user room | {participants: [{id, status, progress}]} | Monitoring update |
| PLAYER_GRID_UPDATE | judge user room | {playerId, grid, puzzleId} | Live player grid |
| RANKING_UPDATE | competition room | {rankings: [{rank, name, score, time}]} | Live ranking |
| ROUND_RANKING | display room | {roundId, rankings} | Round final ranking |
| FINAL_RANKING | display room | {rankings, categories} | Competition final |

### New Events (Client → Server)

| Event | Sender | Payload | Description |
|-------|--------|---------|-------------|
| display_connect | Display | {token} | Display authenticates |
| display_heartbeat | Display | {} | Keep-alive |

---

*End of Development Plan*
