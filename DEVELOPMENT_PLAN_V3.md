# Development Plan v3 — Consolidated Status Snapshot

> **Generated:** 2026-08-23, from branch `louise` at commit `909471c`
> **Purpose:** A single sheet listing every functionality from both prior plans
> (`DEVELOPMENT_PLAN.md`, the 14-day plan, and `development_plan_v2.md`, the
> 7-day plan) with its verified state in the current code, so we can decide
> what to work on next without re-reading 2600 lines.
> **How each row was verified:** by opening the relevant files, running the
> existing test suites (server: 446/446 pass; client: 273/273 pass), and
> checking the actual imports/routes/exports — not by trusting comments or
> earlier status notes.
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
| F26 | Stage/round changes locked once PUBLISHED | ⚠️ | Sylvain | `configureStages` still allows `DRAFT` OR `PUBLISHED` — see plan v2 §14bis, not tightened. |

### 2.4 Participant and Judge Management

| # | Feature | Status | Owner | Evidence / Gaps |
|---|---------|--------|-------|-----------------|
| F27 | Excel participant import (per competition) | ✅ | Louise | `ParticipantImport.jsx` + `services/ParticipantImportService.js`. |
| F28 | Auto team creation from Excel column | ✅ | Louise | `participant-bulkImport-teams.test.js`. Replaced the manual team UI on 2026-08-16. |
| F29 | Auto-generated participant credentials + export | ✅ | Louise | `services/ParticipantExportService.js` + `services-participant-excel.test.js`. |
| F30 | Judge **assignment** (existing user) | ✅ | Sylvain | `POST /competitions/:id/judges` in `competitionSetup.js`. |
| F31 | Judge **creation** with generated credentials | ⚠️ | Louise | Backend usable — `POST /api/users` accepts `role: 'JUDGE'`. **No dedicated UI** yet. Decision needed with Sylvain on route split (create vs assign share the same verb+path — ISSUE-027) before adding UI. |
| F32 | Dashboard page `/dashboard/participants` | ❌ | Louise | Currently `ComingSoonPage`. The functionality exists per-competition inside `CompetitionDetailPage`; a global page has never been built. |
| F33 | Dashboard page `/dashboard/judges` | ❌ | Louise | Currently `ComingSoonPage`. See F31. |
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
| F42 | Round auto-ends on timer expiry (server dispatches emissions) | ⚠️ | Sylvain | **Fix is in the working tree** (`GameOrchestrator.js` at `startGameplayTimer` + `startTimerTick` now dispatch via `processEmissions`) but **not committed**. Was ISSUE-014. The `disconnect-recovery.test.js` case for this is a placebo (`expect(true).toBe(true)`), so tests do NOT actually cover it. |
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
| F55 | **STAGE_RANKING view** | ❌ | Louise | Server emits (`emitStageRanking` line 451). **No client view, no judge button.** The only display mode with no UI. |
| F56 | Judge console button per display mode | ⚠️ | Louise | `DisplayModeControls.jsx` exposes DEFAULT / LIVE / ROUND / FINAL (4 of 5 possible buttons). PLAYER_BROADCAST is set by the projection button in the monitoring panel. STAGE_RANKING is missing — matches F55. |
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
| F69 | End-of-stage screen (nothing after last round of a stage) | ❌ | Louise/Sylvain | Server emits `STAGE_FINISHED`, no `ROUND_TRANSITION_STARTED` — the player just falls back to the waiting screen. Plan v2 §4. |
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
| F77 | Category filter on results page | ❌ | Louise | Data is fetched with categories, but no dropdown yet. Trivial add. |
| F78 | Participants page | ❌ | Louise | See F32. |
| F79 | Judges page | ❌ | Louise | See F33. |
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
| F88 | PDF import service | ❌ | Louise | No `PdfImportService.js`, no `POST /puzzle-bank/import-pdf`, no UI. **Now unblocked** — `sudoku_question_import_sample.pdf` was committed on 2026-08-23. |
| F89 | Puzzle bank persistent counter / DB table (design fix) | ❌ | Louise | Design note only — see ISSUE-025. Currently a growing JSON file. |

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
| F101 | Server messages translated for English UI | ✅ | Louise | `client/src/i18n/serverMessages.js` — 105 keys as of 2026-08-23. |
| F102 | Server messages introduced by security commit translated | ❌ | Louise | 12 new Chinese messages (`无权访问此竞赛`, `队伍不存在`, `操作失败，请重试`, etc.) added by commits `3965d99` / `e8871b1` are NOT in the translation table. Same class of gap ISSUE-011 originally caught. |
| F103 | Startup recovery for orphaned IN_PROGRESS rounds | ✅ | Sylvain | `index.js` lines 35-80. |
| F104 | DB backup script + doc | ✅ | Sylvain | `scripts/backup.sh`, `docs/DATABASE_BACKUP_RESTORE.md`. |
| F105 | `.env.production` **NOT** tracked in git | ❌ | Sylvain | Still tracked (`git ls-files server/.env.production` returns the path). Secrets in git history — ISSUE-018, HIGH. |
| F106 | Structured logger (Pino) in Louise's files | ✅ | Louise | `utils/logger.js`. |
| F107 | Same logger applied to Sylvain's files | ❌ | Sylvain | ~33 `console.*` calls still in `SocketManager.js` (13), `DisplayManager.js` (5), `GameOrchestrator.js` (5), `routes/display.js` (7), plus 3 elsewhere. Skips log-level filtering and secret redaction. |

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
| F112 | Server test suite (Jest) | ✅ | Both | 27 files, 446/446 passing. |
| F113 | Client test suite (Vitest + React Testing Library) | ✅ | Louise | 27 files, 273/273 passing. |
| F114 | E2E competition simulation | ⚠️ | Sylvain | `e2e-competition-simulation.test.js` (1326 lines) — a Jest scripted lifecycle. **Not the live 40-step manual run** the plan asked for; and the `disconnect-recovery.test.js` "round auto-end on timer expiry" case is a placebo. |
| F115 | Frontend documentation updated | ⚠️ | Louise | `FRONTEND_DOCUMENTATION.md` — body is old, "August 2026 Updates" section at the top is the current source of truth. |
| F116 | Backend documentation updated | ⚠️ | Louise | `BACKEND_DOCUMENTATION.md` — same pattern. |
| F117 | Org admin user guide | ✅ | Louise | `Louise/GUIDE_ADMIN_ORGANISATION.md` (git-ignored). |
| F118 | Judge quick-start guide | ✅ | Louise | `Louise/GUIDE_JUGE_QUICKSTART.md` (git-ignored). |
| F119 | Public README / project setup guide | ❌ | Both | Nothing at repo root beyond the two dev plans. |

---

## 3. What is still missing, ordered by urgency

### 3.1 Blocking or high-risk (fix before ship)

1. **F42 — ISSUE-014 (round auto-end on timer expiry).** The fix is
   in the working tree, uncommitted, with no real test covering it.
   Until it lands, a competition run without a judge clicking "end
   round" will silently freeze mid-round. Highest severity.
2. **F105 — ISSUE-018 (secrets in git).** `server/.env.production`
   with `DATABASE_URL` + `JWT_SECRET` is still tracked. Anyone with
   read access to the repo can forge JWTs and reach the production
   DB. Requires secret rotation + `git rm --cached` + history scrub
   coordination. Cannot be automated.
3. **F102 — 12 untranslated server messages.** Introduced by the
   security commit. Same defect class as ISSUE-011. English users
   will see raw Chinese on a dozen error paths. Trivial fix.

### 3.2 Missing UI, no external blocker

4. **F55 / F56 — STAGE_RANKING view + judge button.** Server already
   emits, only the client view + one button are missing. Same shape
   as `RoundRankingView` and `DisplayFinalRankingView`, quick to
   build.
5. **F77 — Category filter on the Results page.** Data already in
   the snapshot. One dropdown.
6. **F65 — Score/age/category in monitoring payload.** Sylvain owns
   the route; not blocking but planned.
7. **F69 — End-of-stage player screen.** Server-side event needed
   from Sylvain (`ROUND_TRANSITION_STARTED` variant or a new
   `STAGE_FINISHED` listener on the player side); then the UI is a
   variant of `TransitionScreen`.
8. **F107 — Convert ~33 remaining `console.*` in Sylvain's files.**
   Mechanical, but not on our side of the code-ownership line.

### 3.3 Blocked by product decisions

9. **F31 — Judge creation UI.** Backend accepts `POST /users` with
   `role: 'JUDGE'` (works), and `POST /competitions/:id/judges` also
   exists but does **assignment**. The two would collide on the same
   verb + path if we wired UI to both — need Sylvain's decision
   before writing UI (ISSUE-027).
10. **F32 / F33 — Dashboard participant/judge pages.** Not urgent
    because per-competition workflows already exist; also depends
    on the decision above for judges.
11. **F88 — PDF import.** No code, but **now unblocked**: the sample
    PDF landed on 2026-08-23. Ready to start.

### 3.4 Deferred by explicit decision

12. **F34 / F80 — Teams management page.** Replaced by Excel import.
13. **F70 — Player results between rounds.** Decided not to show.
14. **F84 — Super Admin management (disable org, reset password).**
    Out of P2 scope, needs review.
15. **F89 — Puzzle bank persistent counter / DB table.** Design
    improvement (ISSUE-025), not urgent.
16. **F119 — Public README.** Not required for MVP.

### 3.5 Test-coverage gaps that hide real risk

17. **F42's disconnect-recovery test is a placebo.** Even if the
    ISSUE-014 fix lands, we have no automated proof it works. A
    real integration test firing a real timer expiry would prevent
    a regression.
18. **F114 — 40-step live E2E.** The Jest E2E covers the shape, not
    the live run.
19. **New R5/R4 server routes have no dedicated test coverage** —
    `routes/admin.js`, `GET /:id/results`, the DisplayManager join
    for entity names. Manual/build verified only (ISSUE-036).

---

## 4. Feature summary (counts)

| Bucket | Count | % |
|---|---|---|
| ✅ Done and verified | 82 | 69 % |
| ⚠️ Partial or in-progress | 12 | 10 % |
| ❌ Not started (real gap) | 15 | 13 % |
| ❌ Not started (intentional / deferred) | 9 | 8 % |
| **Total tracked functionalities** | **118** | 100 % |

By ownership among the 15 real gaps:
- **Louise-side:** F31 (judge creation UI), F32 (participants page),
  F33 (judges page), F55 (STAGE_RANKING view), F56 (STAGE_RANKING
  button), F77 (results filter), F88 (PDF import), F102 (12 missing
  translations), F117-related F119 (README). **9 items.**
- **Sylvain-side:** F42 (round auto-end — fix present but
  uncommitted), F65 (monitoring payload enrichment), F69 (end-of-stage
  event for player), F105 (`.env.production` in git), F107 (`console.*`
  conversion). **5 items.**
- **Both / shared:** F26 (lock config once PUBLISHED — Sylvain owns
  the file, Louise triggers publish). **1 item.**

---

## 5. Suggested next steps for Louise

Given the ownership boundaries and the current blockers, the order
that clears the most value fastest:

1. Wait for Sylvain to commit F42 (round auto-end fix) — do not touch,
   it is in his file.
2. **Do now, no dependency:** F102 (12 translations), F77 (results
   filter), F55 + F56 (STAGE_RANKING view + button). Half a day
   combined.
3. **Do next, PDF is unblocked:** F88 (PDF import service + endpoint
   + UI in `DashboardPuzzleBankPage`). Half to one day.
4. **Bring to the meeting with Sylvain:** F31 (judge creation route
   split), F69 (end-of-stage event contract), F105 (secret rotation
   plan), F65 (monitoring payload fields).
5. Once F31 is decided: build the dedicated judge / participant
   dashboard pages (F32, F33).

Everything else in section 3.4 stays where it is — decisions have
already been made, don't reopen them.

---

*This file is a snapshot, not a live tracker. It is meant to be shown
to Sylvain at your next meeting to align on what remains. The
`Louise/JOURNAL_MODIFICATIONS.md`, `Louise/KNOWN_ISSUES.md` and
`Louise/POINTS_POUR_SYLVAIN.md` remain the authoritative day-to-day
tracking files.*
