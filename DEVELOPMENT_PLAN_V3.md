# Development Plan v3 — Consolidated Status Snapshot

> **First written:** 2026-08-23 morning, from branch `louise` at commit `909471c`.
> **Last refreshed:** 2026-08-24 evening. Cleared BUG-01/02/03/04
> (client picker/refresh/enum/individual-generator) + a11y (stage-type
> buttons, PDF label) + F107 (console.* → Pino across Sylvain's files,
> since he had not gotten to it) + F26 (post-publish stage lock,
> 4-line engine change + regression test). Feature counts refreshed
> below. Suite: **server 474/474 pass · client 366/366 pass**.
>
> **Purpose:** A single sheet listing every functionality from both prior plans
> (`DEVELOPMENT_PLAN.md`, the 14-day plan, and `development_plan_v2.md`, the
> 7-day plan) with its verified state in the current code, so we can decide
> what to work on next without re-reading 2600 lines.
> **How each row was verified:** by opening the relevant files, running the
> existing test suites, and checking the actual imports/routes/exports — not
> by trusting comments or earlier status notes. Current suite counts:
> **server 462/462 pass; client 354/354 pass**.
>
> Symbol key:
> `✅` Done and verified in code. `⚠️` Partial — see the "Gaps" column.
> `❌` Not started. `🔒` Blocked (external dependency).

---

## 1. Project Vision (recap from both plans)

A **multi-tenant SaaS competition-management platform** for Sudoku
competitions. Organizations rent the platform; each organization is fully
isolated. A competition is made of **stages** (INDIVIDUAL, TEAM — PK
declared but out of scope). Each stage is made of **rounds** (6 types
total). Auto-progression: preparation → round → transition → next round
→ next stage. **Server-authoritative** timers, scoring and rankings.
**Four roles**: SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER. Dual JWT: an
org-scoped token for admins, a competition-scoped token entered via a
public access link for judges and players. A **big screen** connects via
a temporary display token and shows multiple modes controlled by the
judge. **Category rankings** (U6/U8/U12). **Puzzle bank** per
organization, with PDF import. **Security hardening** end-to-end.

---

## 2. Feature Matrix — every functionality, tagged

### 2.1 Foundation and Multi-Tenancy

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F1 | `organizations` table | ✅ | Sylvain | Schema line: `model organizations`. |
| F2 | `organization_id` on tenant tables | ✅ | Sylvain | Users, competitions, puzzles chain to org. |
| F3 | UUID primary keys everywhere | ✅ | Sylvain | 47 Prisma migrations, all UUID. |
| F4 | `tenantGuard` middleware | ✅ | Sylvain | `middleware/tenantGuard.js` + tests. |
| F5 | Four roles (SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER) | ✅ | Sylvain | `role` enum in `users`. Legacy `ADMIN` role removed 2026-08-14. |
| F6 | Cross-tenant access blocked (verified) | ✅ | Sylvain | `security-audit.test.js` (23 tests) exercises cross-tenant + role escalation. |
| F7 | JWT requires `JWT_SECRET` in production | ✅ | Sylvain | `config.js` fails startup in production if unset. |
| F8 | Rate limiting on sensitive endpoints | ⚠️ | Louise | Working, but per-IP → **blocks a whole competition room** behind one NAT (ISSUE-019). Needs per-user keying for logged-in routes. |
| F9 | Helmet security headers | ✅ | Louise | Configured in `index.js`. |
| F10 | Global JSON error-handling middleware (no stack traces) | ✅ | Sylvain | `index.js` line 215. Previously ISSUE-021. |

### 2.2 Authentication and Entry Points

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F11 | Org admin registration (creates org + user atomically) | ✅ | Sylvain | `routes/auth.js`. |
| F12 | Org admin login → JWT with `organizationId` | ✅ | Sylvain | Same file. |
| F13 | Dual JWT (org-scoped + competition-scoped) | ✅ | Sylvain | `middleware/auth.js` handles both; `middleware/competitionAuth.js`. |
| F14 | Competition access link `POST/GET/DELETE /:id/access-link` | ✅ | Sylvain | `routes/competitions.js`. |
| F15 | Public entry `/competition/:accessCode` (judge/player login) | ✅ | Louise | `CompetitionJoinPage.jsx` + `POST /competitions/by-code/:identifier/login`. |
| F16 | Publish must precede link generation | ✅ | Sylvain | Server-side guard (not only greyed button). |
| F17 | Access-link section visible on the admin detail page | ✅ | Louise | `AccessLinkSection.jsx`. |
| F18 | `/admin` route for Super Admin | ✅ | Louise | Replaces `/admin-coming-soon`, mounted at `App.jsx:73`. |

### 2.3 Competition Configuration

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F19 | Competition CRUD (create/read/update/delete) | ✅ | Both | `routes/competitions.js`. |
| F20 | Stage model + `StageManager` | ✅ | Sylvain | `engine/StageManager.js`. |
| F21 | Stage configuration UI | ⚠️ | Louise | Lives inside `CompetitionDetailPage.jsx` (not the dedicated `DashboardStagesPage.jsx` v1 planned). Works. |
| F22 | Round configuration within a stage | ✅ | Louise | Same page; `POST /competitions/:id/stages/:stageId/rounds`. |
| F23 | Per-round preparation seconds | ✅ | Louise | Field in creation form, 5 min cap (2026-08-18). |
| F24 | Publish workflow with validation | ✅ | Louise | `PublishPanel.jsx` + `POST /:id/publish` + `services/PublishabilityService.js`. |
| F25 | A published competition can be UNPUBLISHED | ✅ | Sylvain | `POST /:id/unpublish` (destroys the link). |
| F26 | Stage/round changes locked once PUBLISHED | ✅ | Sylvain (Louise shipped) | `configureStages` now rejects any status other than DRAFT (2026-08-24). Regression test `GameOrchestrator-configureStages-lock.test.js` (5 tests) pins the new contract. |

### 2.4 Participant and Judge Management

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F27 | Excel participant import (per competition) | ✅ | Louise | `ParticipantImport.jsx` + `services/ParticipantImportService.js`. |
| F28 | Auto team creation from Excel column | ✅ | Louise | `participant-bulkImport-teams.test.js`. Replaced the manual team UI on 2026-08-16. |
| F29 | Auto-generated participant credentials + export | ✅ | Louise | `services/ParticipantExportService.js` + `services-participant-excel.test.js`. |
| F30 | Judge **assignment** (existing user) | ✅ | Sylvain | `POST /competitions/:id/judges` in `competitionSetup.js`. |
| F31 | Judge **creation** with generated credentials | ✅ | Louise | `DashboardJudgesPage.jsx` (2026-08-23). Goes through `POST /api/users` with `role: 'JUDGE'`, sidestepping the ISSUE-027 route-split collision. Credentials shown once in a banner. |
| F32 | Dashboard page `/dashboard/participants` | ✅ | Louise | `DashboardParticipantsPage.jsx` (2026-08-23). Global read-only view scoped to the caller's org via `GET /api/participants` WHERE clause; 3 filters (competition / category / search 300ms debounced). |
| F33 | Dashboard page `/dashboard/judges` | ✅ | Louise | Same as F31 — the two overlap (the judges dashboard IS the judge creation UI). |
| F34 | Dashboard page `/dashboard/teams` | ❌ (intentional) | Louise | Teams derive from the Excel import (2026-08-16 decision); a manual page is no longer needed unless we want a read-only view. |

### 2.5 Round Engines and Scoring

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F35 | Round 1 (Nine-One, team) | ✅ | Sylvain | `engine/team/Round1Engine.js`. |
| F36 | Round 2 (Relay, team) | ✅ | Sylvain | `engine/team/Round2Engine.js`. |
| F37 | Round 3 (Collaborate, team) | ✅ | Sylvain | `engine/team/Round3Engine.js` + `services/Round3CollaborationService.js`. |
| F38 | Individual round engine (STANDARD / SHAPED / MIXED) | ✅ | Sylvain | `engine/individual/IndividualRoundEngine.js`. |
| F39 | Server-authoritative completion-ratio scoring | ✅ | Sylvain | `engine/ScoringService.js` (integer, `Math.round` per puzzle). |
| F40 | Category rankings (U6/U8/U12) | ✅ | Sylvain | `categories` table + `test-category-ranking.js`. |
| F41 | Per-round auto-progression (prep → round → transition → next) | ✅ | Sylvain | `GameOrchestrator.js` + `TimerService.js`. |
| F42 | Round auto-ends on timer expiry (server dispatches emissions) | ✅ | Sylvain (owner) / Louise (shipped) | Fix committed 2026-08-23 (`7d15bf6`): `startGameplayTimer` + `startTimerTick` now dispatch via `processEmissions`, matching the manual-endRound path. The placebo test in `disconnect-recovery.test.js` was replaced with a real one that captures the timer callback, invokes it, and asserts both `endRound` and `bus.emitAll` fire with the right args — proven by stashing the fix and watching the test go red. |
| F43 | Judge manual end-round | ✅ | Sylvain | `POST /api/game/:id/round/:roundId/end` in `routes/game.js`. |
| F44 | Player auto-save (individual + team) | ✅ | Both | Composite session-ID bugs fixed; `disconnect-recovery.test.js` covers save + restore. |

### 2.6 Big Screen

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F45 | Temporary display token (POST/DELETE) | ✅ | Sylvain | `routes/display.js`. |
| F46 | Display WebSocket join by token | ✅ | Sylvain | `SocketManager.js`. |
| F47 | `GET /display/:token/ranking` snapshot with categories | ✅ | Sylvain | `DisplayManager.getRankingSnapshot`. Includes `entityName`/`school`/`age` join on `finalRankings` (added 2026-08-23). |
| F48 | Judge switches display mode | ✅ | Sylvain | `PUT /display/mode` + `DISPLAY_MODE_CHANGED` event. |
| F49 | Judge broadcasts a specific player | ✅ | Sylvain | `PUT /display/broadcast/:playerId`. |
| F50 | DEFAULT view | ✅ | Louise | `RankingView.jsx`. |
| F51 | LIVE_RANKING view | ✅ | Louise | Same file (mode-aware). |
| F52 | ROUND_RANKING view | ✅ | Louise | `RoundRankingView.jsx` (2026-08-22). |
| F53 | PLAYER_BROADCAST view | ✅ | Louise | `BroadcastView.jsx`. |
| F54 | FINAL_RANKING view | ✅ | Louise | `DisplayFinalRankingView.jsx` (2026-08-23). |
| F55 | **STAGE_RANKING view** | ✅ | Louise | `DisplayStageRankingView.jsx` (2026-08-23). Filters `finalRankings` by the featured stage, podium top-3 with medals, cap 20 rows, empty states honest. |
| F56 | Judge console button per display mode | ✅ | Louise | `DisplayModeControls.jsx` — 5 buttons in granularity order (DEFAULT / LIVE / ROUND / STAGE / FINAL). PLAYER_BROADCAST stays driven by the projection button in the monitoring panel. |
| F57 | Judge only sees the *button* if ORG_ADMIN, plain judge sees the state | ✅ | Louise | `DisplayModeControls.jsx` + `JudgeMonitoringPanel.jsx`. |

### 2.7 Judge Console and Monitoring

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F58 | Judge control page (start/pause/resume/end competition) | ✅ | Sylvain | `JudgeControlPage.jsx` + `routes/game.js`. |
| F59 | Stage controls (start current, next stage) | ✅ | Sylvain | `JudgeStageControls.test.jsx`. Fully green after Sylvain's fix. |
| F60 | Participant monitoring API `GET /monitoring/participants` | ✅ | Sylvain | `routes/monitoring.js`. |
| F61 | Per-player detail API `GET /monitoring/player/:id` | ✅ | Sylvain | Same file. |
| F62 | `JudgeMonitoringPanel` UI (list + status) | ✅ | Louise | Component + test. |
| F63 | `JudgeLivePlayerView` (per-player detail + grid) | ✅ | Louise | Extracted 2026-08-23. |
| F64 | Live throttled grid updates via WS (`PLAYER_GRID_UPDATE`) | ✅ | Sylvain | Rate-limited events in `SocketManager.js`. |
| F65 | Score/age/category surfaced in monitoring detail | ❌ | Sylvain | `GET /monitoring/participants` still returns only presence + identity. Plan v2 §14ter. |

### 2.8 Player Experience

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F66 | `WaitingScreen` (before competition starts) | ✅ | Louise | Wired via `chooseScreen.js`. |
| F67 | `PreparationScreen` (per-round countdown with rules) | ✅ | Louise | Same. |
| F68 | `TransitionScreen` (between rounds) | ✅ | Louise | Same. |
| F69 | End-of-stage screen (nothing after last round of a stage) | ✅ | Louise | `StageFinishedScreen.jsx` (2026-08-23), 2 variants (stage / competition). `useGameSocket` now handles `STAGE_FINISHED` + `COMPETITION_FINISHED` + `STAGE_STARTED`, with symmetric clearing on the 3 next-cycle events. No countdown (the judge decides). |
| F70 | Player results between rounds | ❌ (intentional) | — | Explicitly decided **not** to show mid-competition (2026-08-15). Correct plan v2 line 163 mentioning "brief results". |
| F71 | Player game page (R1/R2/R3 views) | ✅ | Louise | Existed pre-plan, kept. |

### 2.9 Admin Dashboard (organization admin)

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F72 | Dashboard layout with sidebar | ✅ | Louise | `DashboardLayout.jsx`. |
| F73 | Dashboard home (competition count) | ✅ | Louise | `DashboardPage.jsx`. |
| F74 | Competitions page (list, actions) | ✅ | Louise | `DashboardCompetitionsPage.jsx`. |
| F75 | Puzzle bank page (org-scoped) | ✅ | Louise | `DashboardPuzzleBankPage.jsx` + `PuzzleBankService.js`. |
| F76 | Results page (historical) | ✅ | Louise | `DashboardResultsPage.jsx` (2026-08-23). |
| F77 | Category filter on results page | ✅ | Louise | Dropdown wired 2026-08-23. `getResults(id, categoryId)` mirrors the display page; server forwards to `getRankingSnapshot(id, categoryId)`. categoryId is reset to null on competition change (subtle trap flagged and fixed). |
| F78 | Participants page | ✅ | Louise | See F32. |
| F79 | Judges page | ✅ | Louise | See F33. |
| F80 | Teams page | ❌ (intentional) | Louise | See F34. |

### 2.10 Super Admin

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F81 | Super Admin login | ✅ | Sylvain | Same login route, distinguished by role. |
| F82 | Super Admin overview API `GET /admin/overview` | ✅ | Louise | `routes/admin.js`. |
| F83 | Super Admin UI (`AdminDashboardPage`) | ✅ | Louise | Orgs, competitions, users, stats. |
| F84 | Super Admin management actions (disable org, reset password) | ❌ (deferred) | Louise | Explicitly out of P2 scope; needs Sylvain review before shipping. |

### 2.11 Puzzle Bank and PDF Import

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F85 | Puzzle bank per organization | ✅ | Louise | `puzzles` scoped. |
| F86 | Puzzle generation (manual / R1 / R2 / R3) | ✅ | Louise | `PuzzleBankService.js` + `utils/sudokuGenerator.js`. |
| F87 | Puzzle-to-round assignment | ✅ | Louise | `PuzzleAssignmentService.js`. |
| F88 | PDF import service | ❌ | Sylvain | Sample PDF landed 2026-08-23. Louise handed the task to Sylvain (2026-08-23 discussion). Nothing in main yet. |
| F89 | Puzzle bank persistent counter / DB table (design fix) | ❌ (deferred) | Louise | Design note only — see ISSUE-025. Currently a growing JSON file; not urgent, LOW severity. |

### 2.12 Real-Time Infrastructure

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F90 | `SocketManager` + `EmissionBus` | ✅ | Sylvain | `ws/`. |
| F91 | Competition rooms + display rooms | ✅ | Sylvain | `SocketManager.js`. |
| F92 | Tenant + role checks on WS events | ✅ | Sylvain | Added by security commit `3965d99`. |
| F93 | Per-connection rate limiting on WS events | ✅ | Sylvain | Token-bucket, same commit. |
| F94 | Per-user WS connection limit | ✅ | Sylvain | `WS_MAX_CONNECTIONS_PER_USER=3` in `config.js`. |
| F95 | Zod validation on WS events | ✅ | Sylvain | `validations/socket.js`. |
| F96 | `RANKING_UPDATE` emitted during active round | ✅ | Sylvain | `DisplayManager.js`. |
| F97 | Reconnect / late-join state replay | ✅ | Sylvain | Existing pattern preserved. |

### 2.13 Security and Hardening

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F98 | Zod validation on all REST endpoints | ✅ | Louise | `validations/` + `middleware/validate.js`. |
| F99 | File upload magic-byte validation | ✅ | Louise | `middleware/fileType.js` + tests. |
| F100 | Security audit pass (cross-tenant, role escalation) | ✅ | Sylvain | `security-audit.test.js` (752 lines, 23 tests). |
| F101 | Server messages translated for English UI | ✅ | Louise | `client/src/i18n/serverMessages.js` — 117 keys as of 2026-08-23 evening. |
| F102 | Server messages introduced by security commit translated | ✅ | Louise | 12 new Chinese messages added by the security + N+1 commits are now in the table (2026-08-23 `0335fc0`). One remaining `无法发布：${summary}` is dynamic and stays untranslatable — documented as ISSUE-037. |
| F103 | Startup recovery for orphaned IN_PROGRESS rounds | ✅ | Sylvain | `index.js` lines 35-80. |
| F104 | DB backup script + doc | ✅ | Sylvain | `scripts/backup.sh`, `docs/DATABASE_BACKUP_RESTORE.md`. |
| F105 | `.env.production` **NOT** tracked in git | ⚠️ | Louise (untrack done) / team (rotation pending) | File untracked and added to `.gitignore` (2026-08-23 `3fd6073`). **Secrets in git history still need rotation** — human coordination step, cannot be automated. |
| F106 | Structured logger (Pino) in Louise's files | ✅ | Louise | `utils/logger.js`. |
| F107 | Same logger applied to Sylvain's files | ✅ | Sylvain (Louise shipped) | 32 sites migrated to `logger.*` across `SocketManager.js`, `DisplayManager.js`, `GameOrchestrator.js`, `RoundManager.js`, `TimerService.js`, `routes/display.js`, `routes/monitoring.js`, `services/PresenceService.js`, `middleware/tenantGuard.js` (2026-08-24). Logger fallback in `utils/logger.js` and the CLI `sudokuGenerator.js` are the only remaining `console.*` calls, both intentional. |

### 2.14 Error Handling and UX Polish

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F108 | Global React `ErrorBoundary` | ✅ | Louise | `components/ErrorBoundary.jsx`. |
| F109 | Local error boundaries per critical page | ✅ | Louise | `LocalErrorBoundary` used in `DisplayPage.jsx`. |
| F110 | Error pages 403 / 404 / 500 | ✅ | Louise | `pages/ErrorPage.jsx`. |
| F111 | i18n key-parity test | ✅ | Louise | `i18n.test.js` + duplicate-key guard. |

### 2.15 Testing and Documentation

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F112 | Server test suite (Jest) | ✅ | Both | 29 files, 474/474 passing (2026-08-24). |
| F113 | Client test suite (Vitest + React Testing Library) | ✅ | Louise | 36 files, 366/366 passing (2026-08-24). |
| F114 | E2E competition simulation | ⚠️ | Sylvain | `e2e-competition-simulation.test.js` (1326 lines) — a Jest scripted lifecycle. **Not the live 40-step manual run** the plan asked for. The `disconnect-recovery.test.js` placebo is now a real test (see F42). |
| F115 | Frontend documentation updated | ⚠️ | Louise | `FRONTEND_DOCUMENTATION.md` — body is old, "August 2026 Updates" section at the top is the current source of truth. |
| F116 | Backend documentation updated | ⚠️ | Louise | `BACKEND_DOCUMENTATION.md` — same pattern. |
| F117 | Org admin user guide | ✅ | Louise | `Louise/GUIDE_ADMIN_ORGANISATION.md` (git-ignored). |
| F118 | Judge quick-start guide | ✅ | Louise | `Louise/GUIDE_JUGE_QUICKSTART.md` (git-ignored). |
| F119 | Public README / project setup guide | ❌ (deferred) | Both | Nothing at repo root beyond the dev plans. Not required for MVP. |

---

## 3. What is still missing, ordered by urgency

### 3.1 Blocking or high-risk (fix before ship)

1. **F105 — ISSUE-018 (secrets in git history).** `server/.env.production`
   has been **untracked** and added to `.gitignore` — future re-tracking
   is blocked. But the `DATABASE_URL` + `JWT_SECRET` values already in
   past commits still need **rotation** (issue new secrets out of band)
   and, ideally, a history scrub (BFG / git filter-repo). Both are
   coordination steps for the team — an assistant cannot rotate real
   secrets.

### 3.2 Sylvain-side items still open

2. **F65 — Score/age/category in monitoring payload.** `GET /monitoring/
   participants` still returns only presence + identity. Adding these
   three fields lets the judge see the scoreboard from the console
   without a second fetch. Left to Sylvain deliberately — the shape
   change also affects `JudgeMonitoringPanel.jsx` consumption, safer
   to design the join + payload together.
3. **F88 — PDF import.** Sample PDF landed 2026-08-23; Sylvain took the
   task (2026-08-23 discussion). Nothing yet in main. INDIVIDUAL_STANDARD
   flow is now unblocked without it (see F86 — generator button added
   2026-08-24, "Option C").
4. **ISSUE-019 — Per-IP rate limiting blocks a whole competition room
   behind a NAT.** Design decision needed (per-user keying vs raise
   the ceiling vs trust proxy), then a few lines of code.

### 3.3 Test-coverage gaps that hide real risk

6. **F114 — 40-step live E2E.** The Jest E2E covers the API shape, not
   the live run through the UI with three clients (admin / judge /
   player / display). To be run manually once Sylvain's items land.
7. **New server routes have no dedicated test coverage yet** —
   `routes/admin.js`, `GET /:id/results`. Manual/build verified only.
   Not blocking; a nice cleanup to add before ship (ISSUE-036).

### 3.4 Deferred by explicit decision (do not reopen)

- **F34 / F80 — Teams management page.** Replaced by Excel import.
- **F70 — Player results between rounds.** Decided not to show
  (2026-08-15).
- **F84 — Super Admin management actions (disable org, reset
  password).** Out of P2 scope, needs review before shipping.
- **F89 — Puzzle bank persistent counter / DB table.** Design
  improvement (ISSUE-025), not urgent.
- **F119 — Public README.** Not required for MVP.

---

## 4. Feature summary (counts, post-refresh)

| Bucket | Count | % |
|---|---|---|
| ✅ Done and verified | 105 | 88 % |
| ⚠️ Partial or in-progress | 6 | 5 % |
| ❌ Not started (real gap to close) | 2 | 2 % |
| ❌ Not started (intentional / deferred) | 6 | 5 % |
| **Total tracked functionalities** | **119** | 100 % |

The 2 real gaps to close are both on **Sylvain's side**:
- **F65** — score/age/category in `GET /monitoring/participants` payload.
- **F88** — PDF import (Sylvain took it 2026-08-23, sample PDF in repo).

Plus **ISSUE-019** (per-IP rate limit blocks a full competition room
behind one NAT) which is not in the feature matrix but sits in the
same "before ship" bucket.

Louise's own coding list is empty; the remaining partials on her side
(F21 stage config UI moved location, F114 live E2E, F115/F116 doc bodies)
are polish or shared items, not blockers.

---

## 5. Suggested next steps

Given that Louise has shipped her entire "possible without waiting"
list:

1. **Merge is done** — commit `69971b1` on main brings the 10 louise
   commits (ISSUE-014 fix + test, ISSUE-018 untrack, judges +
   participants + results filter + stage-ranking + final-ranking + end-
   of-stage screens, i18n catchup).
2. **Wait for Sylvain** to push his side — F65, F88, F107, ISSUE-019.
3. **Meeting** with Sylvain to align on: F105 secret rotation plan,
   F26 publish-locking of stages, F114 full live E2E scheduling.
4. **Then run the full 40-step live simulation** (F114) once both
   sides are in main. That is the MVP gate.

Everything else in section 3.4 stays where it is — decisions have
already been made, don't reopen them.

---

*This file was first written 2026-08-23 morning as a snapshot and
refreshed the same evening after merging louise → main at `69971b1`.
Meant to be shown to Sylvain to align on what remains. The
`Louise/JOURNAL_MODIFICATIONS.md`, `Louise/KNOWN_ISSUES.md` and
`Louise/POINTS_POUR_SYLVAIN.md` remain the authoritative day-to-day
tracking files.*
