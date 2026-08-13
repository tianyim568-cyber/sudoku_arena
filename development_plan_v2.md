# Development Plan v2 — Remaining Work (7 Days)

> **Generated:** 2026-08-13
> **Team:** Sylvain + Louise (both AI-assisted)
> **Branch:** `sylvin` (commit `28d0ba5`)
> **Source of truth:** Backend code + Prisma schema (`server/prisma/schema.prisma`, 47 migrations)

---

## 1. Project Status

### What is DONE (Sylvain Day 1-6, Louise Day 1-3)

| Area | Status | Key Files |
|------|--------|-----------|
| **Multi-tenancy schema** | DONE | 47 migrations, `schema.prisma` with organizations, UUID PKs |
| **tenantGuard middleware** | DONE | `server/src/middleware/tenantGuard.js` |
| **Org admin registration + login** | DONE | `server/src/routes/auth.js` (register creates org+user atomically) |
| **Dual JWT system** | DONE | `server/src/middleware/auth.js` (org-scoped + competition-scoped tokens) |
| **Competition-specific login** | DONE | `server/src/middleware/competitionAuth.js`, `server/src/routes/competitions.js` |
| **Access link system** | DONE | `POST/GET/DELETE /:id/access-link`, `GET /by-code/:accessCode/info` |
| **StageManager + RoundManager** | DONE | `server/src/engine/StageManager.js`, `RoundManager.js` |
| **GameOrchestrator integration** | DONE | `server/src/engine/GameOrchestrator.js` (stage-aware lifecycle) |
| **Auto-progression timers** | DONE | preparation → round → transition → next round (all tests pass) |
| **Individual round engine** | DONE | `server/src/engine/individual/IndividualRoundEngine.js` |
| **Team round engines (R1/R2/R3)** | DONE | `server/src/engine/team/Round1Engine.js`, `Round2Engine.js`, `Round3Engine.js` |
| **Completion-ratio scoring** | DONE | `server/src/engine/ScoringService.js` — `calculateCompletion()` |
| **Individual submission route** | DONE | `POST /api/submissions/individual` in `server/src/routes/game.js` |
| **WebSocket role enforcement** | DONE | `server/src/ws/SocketManager.js` |
| **Big-screen display system** | DONE | `server/src/engine/DisplayManager.js`, `server/src/routes/display.js`, `client/src/pages/DisplayPage.jsx` |
| **Category ranking (U6/U8/U12)** | DONE | `server/test-category-ranking.js` passing |
| **Security hardening (Helmet + Zod)** | DONE | `server/src/middleware/validate.js`, Zod schemas on auth/users/competitions |
| **Dashboard layout** | DONE | `client/src/components/DashboardLayout.jsx`, `DashboardPage.jsx` |
| **Dashboard competitions page** | DONE | `client/src/pages/DashboardCompetitionsPage.jsx` |
| **Competition join page** | DONE | `client/src/pages/CompetitionJoinPage.jsx` |
| **Frontend auth hook (dual JWT)** | DONE | `client/src/hooks/useAuth.jsx` |
| **Puzzle bank (org-scoped)** | DONE | `server/src/routes/puzzleBank.js`, `client/src/pages/DashboardPuzzleBankPage.jsx` |
| **Regression test suite** | DONE | 12 test files, all passing |
| **Rate limiting** | DONE | `server/src/middleware/rateLimiters.js` |
| **File type validation** | DONE | `server/src/middleware/fileType.js` |
| **Auto-save session ID bugs** | DONE | Fixed composite string sessionId in GameOrchestrator, IndividualRoundEngine, SocketManager |

### What REMAINS (gap analysis)

| # | Feature | Original Owner | Original Day | Priority | Effort |
|---|---------|---------------|-------------|----------|--------|
| R1 | **Preparation/Transition/Waiting screens** | Louise | 7 | P0 | Medium |
| R2 | **Stage configuration UI** | Louise | 5 | P0 | Medium |
| R3 | **Judge participant monitoring (backend)** | Sylvain | 8 | P1 | Medium |
| R4 | **Judge monitoring panel (frontend)** | Louise | 8 | P1 | Medium |
| R5 | **Big-screen display modes** | Sylvain+Louise | 9-10 | P1 | Medium |
| R6 | **Real-time ranking emission** | Sylvain | 9 | P1 | Medium |
| R7 | **Results page (historical)** | Louise | 10 | P1 | Low |
| R8 | **Team stage integration verification** | Sylvain | 10 | P0 | Low |
| R9 | **Competition publish workflow** | Louise | 10 | P1 | Medium |
| R10 | **Player auto-save persistence hardening** | Louise | 5 | P0 | Low |
| R11 | **Super Admin interface** | Louise | 11 | P2 | Medium |
| R12 | **PDF import pipeline** | Louise | 8-9 | P1 | High |
| R13 | **Structured logging** | Louise | 11 | P1 | Low |
| R14 | **Disconnect/recovery handling** | Sylvain | 12 | P1 | Medium |
| R15 | **Security audit pass** | Sylvain | 12 | P0 | Medium |
| R16 | **Error boundaries + error pages** | Louise | 12 | P1 | Low |
| R17 | **Full E2E competition simulation** | Both | 13 | P0 | Medium |
| R18 | **Documentation + user guides** | Louise | 14 | P1 | Low |
| R19 | **Deployment preparation** | Sylvain | 14 | P1 | Low |

---

## 2. Architectural Source of Truth

The following are FROZEN — do not redesign. All definitions come from **backend code and database schema**, not frontend routes.

### Database Schema
- **File:** `server/prisma/schema.prisma` with 47 migrations
- **Primary keys:** UUID (via `uuid_generate_v4()`)
- **Compound unique naming:** `field1_field2` (not `field1_field2_unique`)
- **Example:** `puzzle_answers.session_id_puzzle_id` compound unique

### Stage Types (3 types, defined in `server/src/engine/StageManager.js` lines 29-33)

| Stage Type | Value | Status |
|-----------|-------|--------|
| INDIVIDUAL | `'INDIVIDUAL'` | Implemented |
| TEAM | `'TEAM'` | Implemented |
| PK | `'PK'` | Declared but NOT implemented (future) |

**Database storage:** `competition_stages.type` (varchar(50))

### Round Types (6 types total, defined in `server/src/engine/RoundTypes.js` lines 14-38)

**TEAM stage rounds (3 types):**

| Round Type | Value | Engine | Description |
|-----------|-------|--------|-------------|
| Nine-One (9+1) | `ROUND1_NINE_ONE` | `Round1Engine` | 9 JOC puzzles + 1 FINAL puzzle; single-cell submissions reveal letter clues |
| Relay | `ROUND2_RELAY` | `Round2Engine` | 16 puzzles per team; players rotate every 60s; points vary by difficulty |
| Collaborate | `ROUND3_COLLABORATE` | `Round3Engine` | 10 shared puzzles; team members propose/accept/reject cells collaboratively |

**INDIVIDUAL stage rounds (3 types):**

| Round Type | Value | Engine | Description |
|-----------|-------|--------|-------------|
| Standard | `INDIVIDUAL_STANDARD` | `IndividualRoundEngine` | Classic Sudoku puzzles; completion-based scoring |
| Shaped | `INDIVIDUAL_SHAPED` | `IndividualRoundEngine` | Sudoku with shaped (non-square) regions |
| Mixed | `INDIVIDUAL_MIXED` | `IndividualRoundEngine` | Mixed puzzle types in single round |

**PK stage rounds:** 0 types (empty `PKRoundType = Object.freeze({})`)

**Engine dispatch:** `server/src/engine/GameOrchestrator.js` lines 97-111 — `_getEngine(roundType)` maps round types to engines

### Competition Lifecycle States
Defined in backend engine layer (not frontend):
```
WAITING → STAGE_STARTED → PREPARATION → ROUND_ACTIVE → ROUND_FINISHED → TRANSITION → STAGE_FINISHED → COMPETITION_FINISHED
```

### Roles (4 types)
`SUPER_ADMIN`, `ORG_ADMIN`, `JUDGE`, `PLAYER`

### Dual JWT System
- **Org-scoped token** (24h expiry): dashboard access, org_id in payload
- **Competition-scoped token**: entry link access, competition_id in payload
- **Unified middleware:** `server/src/middleware/auth.js` handles both

### Emission Pattern
- Game logic returns emissions (no Socket.io direct calls)
- `EmissionBus` routes emissions to `SocketManager`
- `SocketManager` broadcasts to appropriate rooms

### Validation
- **Zod schemas:** `server/src/validations/`
- **Error codes:** `40001` for validation errors, `4003` for business conflicts
- **Middleware:** `server/src/middleware/validate.js`

### Route Architecture (Backend Only)
- **`server/src/routes/tournaments.js`:** CRUD via repos pattern (legacy)
- **`server/src/routes/competitions.js`:** Access/auth via Prisma (new)
- **Complementary, not duplicates**

### Session Management (Individual Rounds)
- **`player_round_sessions` table:** One row per (round_id, participant_id) pair
- **Session ID:** Auto-generated UUID (NOT composite string)
- **`puzzle_answers.session_id`:** Foreign key to `player_round_sessions.id` (UUID type)
- **Compound unique:** `round_id_participant_id` on `player_round_sessions`

---

## 3. Seven-Day Schedule

### Day 1 — Preparation/Transition Screens + Stage Configuration UI

**Goal:** Players see proper screens during competition lifecycle. Admin can configure stages/rounds in dashboard.

#### Sylvain
- [ ] Verify team round engines (R1/R2/R3) work within TEAM stage context via GameOrchestrator
- [ ] Write test: start TEAM stage → R1/R2/R3 rounds execute → TEAM stage completes
- [ ] Run full regression suite to confirm auto-save fixes don't break anything

**Deliverables:** Team stage integration verified; all tests green.

#### Louise
- [ ] Build `PreparationScreen.jsx` — shows round rules, countdown timer, "Get Ready" message
- [ ] Build `TransitionScreen.jsx` — shows "Round X complete", brief results, countdown to next round
- [ ] Build `WaitingScreen.jsx` — "Waiting for judge to start..." message
- [ ] Integrate all three screens into `PlayerGamePage.jsx` — show correct screen based on competition state (PREPARATION, TRANSITION, WAITING)
- [ ] Verify frontend compiles (`npx vite build`)

**Deliverables:** Three screen components wired into player game flow.

**Dependencies:** None (parallel tracks).

---

### Day 2 — Judge Monitoring Backend + Stage Configuration UI

**Goal:** Backend supports participant monitoring. Stage/round configuration UI complete.

#### Sylvain
- [ ] Implement `GET /api/competitions/:id/monitoring/participants` — participant list with live status (online/offline from heartbeat)
- [ ] Add `PARTICIPANT_STATE_UPDATE` WebSocket event (to judge room only)
- [ ] Implement `GET /api/competitions/:id/monitoring/player/:playerId` — player's current puzzle state
- [ ] Add `PLAYER_GRID_UPDATE` event emission when player fills cell (throttled: max 2/s per player)
- [ ] Add WebSocket message rate limiting (max events per second per connection)
- [ ] Write tests for monitoring endpoints

**Deliverables:** Monitoring API + WebSocket events working.

#### Louise
- [ ] Build `DashboardStagesPage.jsx` — stage configuration UI (add/remove stages, set types INDIVIDUAL/TEAM)
- [ ] Build round configuration within stages (duration, puzzle assignment from bank)
- [ ] Update `TournamentDetailPage.jsx` to show stage-aware competition structure
- [ ] Verify frontend compiles

**Deliverables:** Stage/round configuration UI in dashboard.

**Dependencies:** None (parallel tracks).

---

### Day 3 — Real-Time Ranking + Big-Screen Display Modes

**Goal:** Live ranking emitted during rounds. Big screen supports multiple display modes.

#### Sylvain
- [ ] Add `RANKING_UPDATE` WebSocket emission during active round (calculated server-side from submissions)
- [ ] Implement `PUT /api/display/mode` — judge changes display mode (DEFAULT, LIVE_RANKING, PLAYER_BROADCAST, ROUND_RANKING, FINAL_RANKING)
- [ ] Emit `DISPLAY_MODE_CHANGED` to display room
- [ ] Implement judge broadcast player: `PUT /api/display/broadcast/:playerId`
- [ ] Emit `DISPLAY_PLAYER_BROADCAST` event to display room
- [ ] Add `ROUND_RANKING`, `STAGE_RANKING`, `FINAL_RANKING` emission events
- [ ] Write tests for ranking emission and display mode changes

**Deliverables:** All display mode backend events working; live ranking emitted.

#### Louise
- [ ] Build `DisplayRankingView.jsx` — big-screen ranking table (sortable, auto-updating via WebSocket)
- [ ] Build `DisplayPlayerBroadcastView.jsx` — big-screen shows player's puzzle grid
- [ ] Build `DisplayRoundRankingView.jsx` — round results display
- [ ] Build `DisplayFinalRankingView.jsx` — final competition ranking
- [ ] Integrate all display views into `DisplayPage.jsx` with mode switching
- [ ] Build judge "Connect Big Screen" button + token display modal in `JudgeControlPage.jsx`
- [ ] Verify frontend compiles

**Deliverables:** All display mode views rendered and mode-switchable.

**Dependencies:** Day 2 monitoring backend (for player broadcast data). Both tracks can start in parallel — Louise can build views with mock data first.

---

### Day 4 — Judge Monitoring Frontend + Results Page + Publish Workflow

**Goal:** Judge can monitor participants live. Admin can view results and publish competitions.

#### Sylvain
- [ ] Add idempotency guards to competition state transitions (prevent double-start)
- [ ] Implement disconnect recovery:
  - Player disconnect during round: preserve last auto-saved state (already handled by auto-save)
  - Judge disconnect: server continues timer, round auto-ends on expiry
  - Big screen disconnect: auto-reconnect if token not expired
- [ ] Review and optimize N+1 query patterns in monitoring/ranking endpoints
- [ ] Write tests for idempotency and disconnect recovery

**Deliverables:** Robust state transitions; disconnect recovery verified.

#### Louise
- [ ] Build `JudgeMonitoringPanel.jsx` — participant grid/list with status indicators (online/offline/active)
- [ ] Add hover info card (name, school, age, category, status)
- [ ] Add click action: open player detail / broadcast to big screen
- [ ] Build `JudgeLivePlayerView.jsx` — shows selected player's puzzle state in real-time
- [ ] Build `DashboardResultsPage.jsx` — view historical competition results (round-by-round)
- [ ] Build competition publish workflow: validate all rounds have puzzles → enable publish button
- [ ] Implement `POST /api/competitions/:id/publish` endpoint with validation
- [ ] Verify frontend compiles

**Deliverables:** Judge monitoring UI; results page; publish validation.

**Dependencies:** Day 2 monitoring backend (Louise); Day 3 ranking events (Sylvain's disconnect recovery is independent).

---

### Day 5 — Security Audit + PDF Import + Category UI + Super Admin

**Goal:** Security vulnerabilities fixed. Basic PDF import. Category filtering. Super Admin interface.

#### Sylvain
- [ ] Security audit pass:
  - Review all REST endpoints for missing auth/role checks
  - Review WebSocket event authorization completeness
  - Test cross-tenant access attempts (REST + WebSocket)
  - Test role escalation attempts (player accessing judge APIs)
  - Verify no stack traces or internal paths in error responses
  - Verify invalid/expired token handling
- [ ] Fix any vulnerabilities found
- [ ] Write comprehensive security test suite additions

**Deliverables:** Security audit complete; vulnerabilities fixed; security tests expanded.

#### Louise
- [ ] Install PDF parsing library (`pdf-parse` or `pdfjs-dist`)
- [ ] Create `PdfImportService.js` — basic PDF text extraction for 9x9 grids
- [ ] Implement `POST /api/puzzle-bank/import-pdf` endpoint with validation (PDF MIME, 20MB limit)
- [ ] Build PDF import UI in `DashboardPuzzleBankPage.jsx` (upload, preview, confirm)
- [ ] Add category selection to ranking displays (dropdown: All, U6, U8, U12) in `DisplayPage.jsx` and results
- [ ] Build Super Admin pages: `AdminDashboardPage.jsx` (org list, competition list, platform stats)
- [ ] Add `/admin/*` route group with SUPER_ADMIN auth guard
- [ ] Verify frontend compiles

**Deliverables:** Basic PDF import; category filter UI; Super Admin pages.

**Dependencies:** None (Sylvain's security audit is independent of Louise's feature work).

---

### Day 6 — WebSocket Hardening + Structured Logging + Error Handling

**Goal:** Production-grade logging, error boundaries, connection limiting.

#### Sylvain
- [ ] Add WebSocket connection limiting (max connections per user)
- [ ] Review and fix race conditions: judge endRound + timer expiry concurrent
- [ ] Test server restart recovery (start competition → restart server → verify state behavior)
- [ ] Verify all database migrations are idempotent and reproducible
- [ ] Update production environment configuration (verify JWT_SECRET required, no dev defaults)
- [ ] Create database backup/restore procedure notes

**Deliverables:** Connection limiting; race condition fixes; deployment config verified.

#### Louise
- [ ] Install and configure structured logging (Winston or Pino)
- [ ] Configure log levels: ERROR for production, DEBUG for development
- [ ] Add logging for: auth failures, competition state changes, display connections, file uploads
- [ ] Build comprehensive error boundary components in React
- [ ] Add user-friendly error pages (404, 403, 500)
- [ ] Test and fix all loading states and error states across pages
- [ ] Review all server error responses: ensure no stack traces or internal paths exposed
- [ ] Verify `.env` is in `.gitignore` and credentials are rotated
- [ ] Verify frontend compiles

**Deliverables:** Structured logging active; error boundaries in place; no error information disclosure.

**Dependencies:** None (parallel tracks).

---

### Day 7 — Full Competition Simulation + Documentation

**Goal:** Run complete end-to-end competition. Document everything. Ship-ready.

#### Sylvain
- [ ] Run full end-to-end competition simulation (40-step scenario):
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
- [ ] Document all bugs found
- [ ] Fix all P0 bugs
- [ ] Verify all WebSocket events flow correctly through full lifecycle

**Deliverables:** Full simulation passing; P0 bugs fixed.

#### Louise
- [ ] Write E2E test scripts for critical API paths (Supertest)
- [ ] Test participant import with various Excel formats and edge cases
- [ ] Test credential export format is usable for distribution
- [ ] Verify all dashboard pages render correctly with data
- [ ] Test competition publish validation catches all incomplete configurations
- [ ] Test big-screen display in all modes
- [ ] Test preparation/transition screens timing accuracy
- [ ] Document all bugs found
- [ ] Fix P0/P1 bugs
- [ ] Update `FRONTEND_DOCUMENTATION.md` and `BACKEND_DOCUMENTATION.md`
- [ ] Create user guide for organization admin (competition setup walkthrough)
- [ ] Create judge quick-start guide (how to run a competition)

**Deliverables:** E2E tests; documentation complete; user guides written.

**Dependencies:** All previous days complete.

---

## 4. Dependency Map

```
Day 1 (parallel)
  Sylvain: Team stage verification
  Louise:  Preparation/Transition/Waiting screens
     ↓
Day 2 (parallel)
  Sylvain: Judge monitoring backend
  Louise:  Stage configuration UI
     ↓
Day 3 (mostly parallel)
  Sylvain: Display modes + real-time ranking emission
  Louise:  Display mode views (can start with mock data)
     ↓
Day 4 (Sylvain independent, Louise needs Day 2 backend)
  Sylvain: Idempotency + disconnect recovery
  Louise:  Judge monitoring UI + results page + publish
     ↓
Day 5 (parallel)
  Sylvain: Security audit
  Louise:  PDF import + category UI + Super Admin
     ↓
Day 6 (parallel)
  Sylvain: WebSocket hardening + race conditions + deployment
  Louise:  Structured logging + error boundaries
     ↓
Day 7 (integration — both needed)
  Sylvain: Full E2E simulation + P0 fixes
  Louise:  E2E tests + documentation + P0/P1 fixes
```

**Cross-dependencies (must respect order):**
- Day 3 Louise display views need Day 2 Sylvain monitoring backend (for player data)
- Day 4 Louise judge monitoring UI needs Day 2 Sylvain monitoring endpoints
- Day 7 both developers need all Days 1-6 complete

**No cross-dependencies within the same day** — all daily tracks are parallelizable.

---

## 5. Collaboration Rules

### Code Ownership (avoid merge conflicts)

| Module | Owner | Others may read but NOT modify without discussion |
|--------|-------|--------------------------------------------------|
| `server/src/engine/*` | Sylvain | GameOrchestrator, StageManager, RoundManager, all engines |
| `server/src/ws/*` | Sylvain | SocketManager, EmissionBus |
| `server/src/routes/game.js` | Sylvain | Game control endpoints |
| `server/src/routes/display.js` | Sylvain | Display token/ranking endpoints |
| `server/src/middleware/tenantGuard.js` | Sylvain | Tenant isolation logic |
| `server/src/routes/competitions.js` | Shared | Access links (Sylvain), login (both) |
| `server/src/routes/auth.js` | Shared | Registration (Sylvain), validation (Louise) |
| `server/src/routes/users.js` | Louise | User CRUD |
| `server/src/routes/participants.js` | Louise | Participant import |
| `server/src/routes/puzzleBank.js` | Louise | Puzzle bank |
| `server/src/validations/*` | Louise | Zod schemas |
| `server/src/middleware/validate.js` | Louise | Validation middleware |
| `client/src/pages/*` | Louise | All frontend pages |
| `client/src/components/*` | Louise | All frontend components |
| `client/src/hooks/*` | Louise | Auth hooks |
| `client/src/api/*` | Shared | API client functions |

### Daily Workflow

1. **Start of day:** Both developers pull latest `main` and create/rebase feature branches
2. **During day:** Work on assigned tasks; commit incrementally
3. **End of day:** Run full regression test suite (`node test-*.js` for all 12 files); fix breakages before merging
4. **Merge order:** Sylvain merges first (backend), then Louise (frontend + integration)
5. **If blocked:** Notify immediately; switch to next independent task on the list

### Testing Requirements

- Every new endpoint: write a test file or extend existing test before end of day
- Every frontend page: verify `npx vite build` succeeds
- Every day end: run all 12 regression test files — zero failures required
- Day 7: full 40-step E2E simulation must pass

### Communication Protocol

- If a task reveals a bug in the other developer's code: file it as a note, fix only if P0 and you own the module
- If a schema change is needed: STOP — discuss first (schema is frozen)
- If a task takes longer than estimated: skip P2 items first, then defer P1 items to a "post-MVP" list

---

## 6. Risk Mitigation

| Risk | Mitigation | Owner |
|------|-----------|-------|
| PDF extraction fails with actual PDFs | Accept as P1; manual puzzle entry is the fallback | Louise |
| Team round engines break with StageManager | Day 1 verification; fallback: manual round start for team stage | Sylvain |
| Security audit reveals P0 vulnerability | Fix immediately; defer P1 features if needed | Sylvain |
| Day 7 simulation finds too many bugs | Fix P0 only; document P1+ for post-MVP sprint | Both |
| WebSocket performance under load | Throttle high-frequency events; batch ranking updates | Sylvain |
| Server restart loses in-memory timer state | Document limitation; Redis StateRepository is post-MVP | Sylvain |

---

## 7. MVP Acceptance Criteria (End of Day 7)

All items must be checked:

**Authentication & Authorization**
- [ ] Organization admin registers + logs in (JWT with org_id)
- [ ] Tenant isolation enforced on all queries
- [ ] Judges/players login via competition entry point
- [ ] Super Admin has minimal interface
- [ ] Role-based access enforced on backend

**Competition Configuration**
- [ ] Admin creates competition with stages (INDIVIDUAL/TEAM)
- [ ] Admin configures rounds within stages (3 types per stage)
- [ ] Admin assigns puzzles from bank to rounds
- [ ] Competition publish with validation

**Participant & Judge Management**
- [ ] Excel participant import with org scoping
- [ ] Auto-generated credentials + export
- [ ] Judge creation with credential generation

**Competition Execution**
- [ ] Players/judges enter via /competition/{accessCode}
- [ ] Preparation screen → auto-start → rounds auto-progress
- [ ] Player auto-save survives refresh (using actual session UUID)
- [ ] Judge can end round early
- [ ] Stage completion → next stage startable

**Scoring & Ranking**
- [ ] Completion-ratio scoring (server-side)
- [ ] Round/stage/final rankings
- [ ] Category rankings (U6/U8/U12)

**Big Screen**
- [ ] Connects via temporary token URL
- [ ] Multiple display modes (ranking, player broadcast, round/final results)
- [ ] Judge controls display mode

**Security**
- [ ] Helmet headers configured
- [ ] Zod validation on all endpoints
- [ ] Rate limiting on sensitive endpoints
- [ ] No critical cross-tenant vulnerabilities
- [ ] WebSocket authorization enforced
