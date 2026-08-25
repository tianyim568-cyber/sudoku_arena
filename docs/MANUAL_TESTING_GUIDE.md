# Manual Testing Guide — Sudoku Arena

> **Audience:** Louise, Sylvain, and anyone validating the app before a real
> in-room competition or a production deployment.
>
> **Why this exists:** the 891 automated tests (524 server + 367 client) verify
> the units in isolation. They do **NOT** cover the real-time flow between
> browsers: WebSocket synchronization, big-screen projection, state transitions,
> reconnection recovery. This guide is the ground-truth pre-flight checklist.
>
> **Written:** 2026-08-25. Update the date and add a note whenever a scenario
> changes shape.
>
> **How to use:** open the file, tick the boxes as you go. Every scenario is
> self-contained — pick any starting point. Failure = write it down in
> `Louise/KNOWN_ISSUES.md` (private) or open a GitHub issue (public), quoting
> the scenario number.

---

## 0. Setup — do this once before any scenario

### 0.1 Local environment

- [ ] PostgreSQL is running (Docker or local) on port 5432
- [ ] `server/.env` exists with `JWT_SECRET`, `DATABASE_URL`, `PORT=3001`, `NODE_ENV=development`
- [ ] Migrations up to date: from `server/` run `npx prisma migrate deploy`
- [ ] Client generated: from `server/` run `npx prisma generate`
- [ ] Seed the demo data: from `server/` run `npx prisma db seed`
- [ ] Start the server: from `server/` run `npm run dev` — should listen on 3001, no red errors
- [ ] Start the client: from `client/` run `npm run dev` — opens on `http://localhost:5173`
- [ ] The login page loads with a language selector top-right

### 0.2 Demo accounts (from the seed)

| Role | Username | Password | Landing route |
|---|---|---|---|
| **SUPER_ADMIN** | `admin` | `admin123` | `/dashboard` (platform overview) |
| **ORG_ADMIN** | created via UI from SUPER_ADMIN | — | `/dashboard/competitions` |
| **JUDGE** | `judge` | `judge123` | `/dashboard/competitions` |
| **PLAYER** | `player1` … `player8` | `player123` | `/competitions` |

### 0.3 Browsers to open

Real testing needs multiple sessions in parallel — always the same set:

- **Tab A** — Chrome or Firefox, admin/judge session
- **Tab B** — Chrome Incognito or Firefox Private, one player
- **Tab C** — another Chrome profile OR another private window, another player
- **Tab D** — full-screen (F11) for the big screen display

Tip: never test different roles in the same browser tab — the JWT token gets
overwritten and you'll waste time chasing phantom bugs.

---

## 1. SUPER_ADMIN scenarios

The super admin owns the platform. They provision organizations, oversee every
tenant, and never touch a competition themselves.

### 1.1 Login and platform dashboard

- [ ] Tab A: login as `admin` / `admin123`
- [ ] Lands on `/dashboard`, sidebar shows: **Overview**, **Organizations**, **Users**, **Puzzle Bank**, **Competitions**, **Results**
- [ ] Overview page shows KPI cards: total orgs, total users, total competitions, competitions active now
- [ ] All KPIs render numbers, not "NaN" or "—"
- [ ] Toggle language ZH ↔ EN — all labels update instantly, no page reload

### 1.2 Create an organization

- [ ] Tab A: `Organizations > + Create` → name "Test Org A", contact email
- [ ] The new org appears in the list with status `ACTIVE`
- [ ] Create a second organization "Test Org B" — must succeed with a distinct UUID

### 1.3 Create an ORG_ADMIN for a specific organization

- [ ] Tab A: `Users > + Create User` → role `ORG_ADMIN`, choose "Test Org A" as organization
- [ ] The generated username and password are shown ONCE in a green banner
- [ ] Copy them, then close the banner — the password is now unrecoverable (bcrypt-hashed server-side)
- [ ] The new user appears in the Users list under the "Org Admins" tab, scoped to Test Org A

### 1.4 Cross-tenant isolation (critical)

**Setup:** two orgs (A + B), each with its own ORG_ADMIN (see 1.3).

- [ ] Tab B: login as ORG_ADMIN of Test Org A
- [ ] Create a competition "Comp-A" — should succeed
- [ ] Tab C: login as ORG_ADMIN of Test Org B
- [ ] Comp-A must **NOT** appear in Tab C's competition list
- [ ] From Tab C, try to visit `/dashboard/competitions/{comp-a-id}` directly (URL manipulation) — must return 404 or 403, never the competition data
- [ ] Same test the other way (Comp-B not visible to Org A admin)

**Regression alarm:** any leak here is a security bug — stop and file it as HIGH.

### 1.5 Deactivate a user

- [ ] Tab A (admin): on the Users page, deactivate a JUDGE
- [ ] Try to login as that judge in Tab B — must be rejected with a clear error
- [ ] Re-activate → login now works again

### 1.6 Global puzzle bank access

- [ ] Tab A: `Puzzle Bank` page loads without error
- [ ] Filter by round type and difficulty — the count updates correctly
- [ ] Preview a puzzle → 9×9 grid renders with initial clues and solution

---

## 2. ORG_ADMIN scenarios

The org admin manages one organization: its competitions, its judges, its
participants. They never see other organizations' data.

### 2.1 Login and dashboard

- [ ] Tab A: login as the ORG_ADMIN created in 1.3
- [ ] Lands on `/dashboard/competitions`, sidebar has: **Competitions**, **Puzzle Bank**, **Participants**, **Users**, **Results**
- [ ] Sidebar does **NOT** show "Organizations" (that's SUPER_ADMIN only)

### 2.2 Create a competition end-to-end

**This is the most-used flow. Every step must work without a browser reload.**

- [ ] `Competitions > + Create` → name "Sunday Contest", description, save
- [ ] The competition appears in the list with status `DRAFT`
- [ ] Click it → opens the detail page with sections: Access Link, Participants, Publish Panel, Stages
- [ ] `+ Add Stage` → choose type (e.g. `INDIVIDUAL_STANDARD`), save
- [ ] Inside the stage, `+ Add Round` → name "Round 1", type `ROUND1_NINE_ONE`, `durationSeconds=60`, `preparationSeconds=10`
- [ ] `Puzzle Bank > Generate` → 10 puzzles, choose round type — puzzles appear in the bank
- [ ] Back on the round, `Import from Bank` → select the 10 puzzles → round now shows 10 puzzles

### 2.3 Assign a judge

- [ ] From the competition detail page, `Assign Judge` dropdown lists judges NOT already assigned
- [ ] Select one → they appear in "Assigned judges"
- [ ] Re-open the dropdown — the assigned judge is now hidden (they can't be assigned twice)

### 2.4 Import participants from Excel

- [ ] `Participants > Import` → upload an Excel with columns `name`, `age`, `school`, `category`
- [ ] The imported list shows every participant with their auto-generated username and password
- [ ] `Export credentials` → downloads an XLSX with (name, username, password) — this is what you print for each competitor
- [ ] Import a malformed file (rename `.txt` to `.xlsx`) → red toast with a clear reason, no crash HTML page, no server stack trace exposed

### 2.5 Import PDF puzzles into a specific round

- [ ] On a round, click `Import PDF` → select a PDF containing sudoku grids
- [ ] Preview shows detected puzzles with position markers (Q1, Q2, …)
- [ ] `Confirm Import` → puzzles land in THIS round only, not in the shared bank
- [ ] Re-import the same PDF into a different round → succeeds (each batch is round-scoped)
- [ ] Import a non-PDF file → clear error, no 500

### 2.6 Publish the competition

- [ ] Publish Panel checklist: judge assigned ✓, participants ✓, stage configured ✓, round has puzzles ✓
- [ ] All four green → `Publish` button is enabled
- [ ] Click `Publish` → status transitions `DRAFT` → `PUBLISHED`
- [ ] The Access Link is now copyable — share it with participants
- [ ] After publish, stage configuration is locked — cannot add/remove stages or change round durations (F26)

### 2.7 Delete a competition

- [ ] Delete a `DRAFT` competition → succeeds after confirmation
- [ ] Delete a `RUNNING` competition → must be **refused** with a clear message

### 2.8 Users page (JUDGE + ORG_ADMIN creation, ISSUE-012)

- [ ] Sidebar → `Users`. Two tabs on top: **Judges** (default) + **Org Admins**, each with a count badge
- [ ] Each tab shows only users of that role; PLAYERs are filtered out (they come via the participant Excel import)
- [ ] `+ Create User` → role select pre-fills with the currently active tab
- [ ] Create a new JUDGE → green banner with credentials, auto-switches to the Judges tab
- [ ] Create a new ORG_ADMIN → banner says "Org admin created", auto-switches to the Org Admins tab
- [ ] The new admin can log in with the shown credentials (test in Tab B)

---

## 3. JUDGE scenarios

The judge is the operator during a competition. They start/pause/end rounds,
monitor live scores, and control what the big screen shows.

### 3.1 Login and console

- [ ] Tab A: login as `judge` / `judge123`
- [ ] Sidebar shows only what a judge needs: **Competitions**, **Results**
- [ ] The Competitions list only shows competitions this judge is assigned to (empty if unassigned)

### 3.2 Full competition life-cycle

**Setup:** one published competition with at least 1 stage, 1 round with
puzzles, 2 participants, this judge assigned.

- [ ] Tab A: open the competition's **Judge Console**
- [ ] Status is `PUBLISHED`. Button `Start Competition` is visible
- [ ] Click `Start Competition` → status becomes `RUNNING`, the first stage is now controllable
- [ ] Click `Start Stage 1` → stage status becomes `RUNNING`, round 1 status becomes `PENDING`, a preparation timer starts server-side
- [ ] Tab B (a player who joined earlier) sees the `PreparationScreen` with the countdown
- [ ] After the preparation window (10 s), click `Start Round` → round status `ROUND_ACTIVE`, timer starts client-side, the player's grid appears in Tab B
- [ ] Wait for the round timer to expire. **⚠️ Known issue ISSUE-014:** the round does NOT stop automatically. The judge must click `End Round` manually
- [ ] Click `End Round` → status `ROUND_FINISHED`, a 10 s transition screen appears in Tab B
- [ ] After the transition, Tab B shows either the next round's `WaitingScreen` or the `StageFinishedScreen`
- [ ] Repeat for each round of the stage
- [ ] Once the last round of the last stage is done, click `End Competition` → status `FINISHED`, final rankings are computed

### 3.3 Pause and resume

- [ ] While the round is `ROUND_ACTIVE`, click `Pause` → timer stops in every player's tab, status `PAUSED`
- [ ] Click `Resume` → timer continues from where it stopped

### 3.4 Live monitoring panel

- [ ] During a round, the Judge Console shows a **Monitoring** panel listing every participant with: name, school, age, category, live score, connection status
- [ ] When a player fills a cell (Tab B), the score updates in the panel within 2 s (WebSocket push)
- [ ] Sort the panel by score, by name, by category — sort persists across polls

### 3.5 Display mode controls (big screen)

- [ ] Judge Console has a **Display Token** section → `Generate` produces a URL
- [ ] Tab D: open that URL in fullscreen (F11)
- [ ] Default view is the **Live Ranking** — top N participants with current scores
- [ ] From Tab A, `Display Mode > Round Ranking` → Tab D switches to the round's ranking within 2 s
- [ ] `Display Mode > Live Player Grid > player1` → Tab D shows player1's live grid, updating as they fill cells (Tab B)
- [ ] `Display Mode > Stage Ranking` → per-stage cumulative scores
- [ ] `Display Mode > Final Ranking` → only meaningful once at least one stage is FINISHED
  - **⚠️ Known limitation:** UUIDs may show instead of participant names (finalRankings needs Sylvain's fix)

### 3.6 Judge projection permission (product decision 2 of 2026-08-24)

- [ ] A simple JUDGE (not an admin) CAN generate a display token and project — no admin escalation needed
- [ ] The `Project` button in the Live Player Grid mode works with just judge role

---

## 4. PLAYER scenarios

The player is the competitor. They join via a link, wait, prepare, play,
and see their results.

### 4.1 Join via access link

- [ ] Tab B: paste the access link `/competition/{accessCode}` in the URL bar
- [ ] Prompted to log in with credentials from the Excel export
- [ ] After login, lands on the competition lobby (WaitingScreen if not started)

### 4.2 Waiting → Preparation → Round transitions

**Setup:** the judge in Tab A drives the competition state.

- [ ] Competition in `PUBLISHED`: player sees the WaitingScreen with the competition name and a "waiting for the judge to start" message
- [ ] Judge starts stage → player screen switches to `PreparationScreen` with a countdown (10 s default, configurable)
- [ ] Countdown finishes → grid loads, timer starts
- [ ] Round ends (judge clicks End Round) → `TransitionScreen` with next-round info (10 s)
- [ ] If another round is in the stage: back to PreparationScreen
- [ ] If stage is done: `StageFinishedScreen` with the stage's ranking
- [ ] If competition is done: `CompetitionFinishedScreen`

### 4.3 Play Round 1 (Nine-One / individual)

- [ ] The grid shows 9 small puzzles ("JOC") arranged around a big final puzzle
- [ ] Click a cell in a small puzzle → number pad appears → pick a digit → the cell fills, the value is sent to the server via WebSocket
- [ ] Fill a small puzzle correctly → it's marked solved, a letter appears (that's a clue for the final puzzle)
- [ ] Once enough small puzzles are solved, the big final puzzle unlocks
- [ ] Fill the big puzzle → `Submit` button appears → click → final score computed and shown

### 4.4 Play Round 2 (Relay / team)

- [ ] Player sees a grid + team indicator (which teammate is currently active)
- [ ] Rotation warning appears 5 s before the switch to the next player
- [ ] Puzzle solved → team score updates for all team members simultaneously

### 4.5 Play Round 3 (Collaborate / team)

- [ ] Multiple players on the same team see the SAME grid
- [ ] Click a cell → propose a value → suggestion visible to teammates (with proposer's name)
- [ ] Teammates vote to accept/reject → majority accepts → value written on the shared grid
- [ ] Focus indicators show where each teammate is currently looking

### 4.6 Language switch mid-game

- [ ] While playing, toggle ZH ↔ EN — the grid state is preserved, only labels change
- [ ] The WebSocket connection does NOT reconnect (check DevTools Network)

### 4.7 See own final results

- [ ] After the competition ends, the player sees their own rank, score, and per-round breakdown
- [ ] Per product decision 1 of 2026-08-24: players do **NOT** see live rankings during the competition (only after)

---

## 5. Big-screen (display) scenarios

The big-screen is a stateless view driven by a temporary token. It has no
login: the token IS the authorization.

### 5.1 Token-based access

- [ ] Open the display URL WITHOUT a token → error page, not a blank screen
- [ ] Open with an expired or malformed token → error, not a leak of ranking data
- [ ] Open with a valid token → connects within 3 s, shows the current display mode

### 5.2 Live sync from judge changes

- [ ] Judge changes display mode → big screen updates in < 2 s
- [ ] Judge revokes the token (or the token expires) → big screen shows "connection lost", not a stale ranking

### 5.3 Layout on different resolutions

- [ ] 1920×1080 (standard projector): all elements fit without scrolling
- [ ] 1366×768 (small screen): text is still readable, no overlap
- [ ] Portrait orientation: the display should still be usable, not blank

---

## 6. Cross-role scenarios (multi-tab)

These need 3+ tabs open simultaneously. They catch the WebSocket sync bugs
that automated tests miss.

### 6.1 Two judges controlling the same competition

- [ ] Two judges assigned. Both open the Judge Console (Tabs A and A')
- [ ] Judge in A clicks `Start Round` → Judge in A' sees the state change within 2 s
- [ ] No double-start conflict, no error toast

### 6.2 Late-joining player

- [ ] Competition is `ROUND_ACTIVE`, round 1 in progress
- [ ] Tab C: player2 logs in for the first time
- [ ] Expected: player2 sees the "waiting for next round" screen — cannot join a round already in progress

### 6.3 Player refresh during a round

- [ ] Player is playing. Refresh the tab (F5)
- [ ] Grid re-loads with the same state (cells they filled are still there)
- [ ] Timer continues from server time, not restarts from full duration

### 6.4 Player disconnect and reconnect

- [ ] Player is playing. DevTools > Network > **Offline** for 15 s → reconnection badge should appear
- [ ] Switch back to **Online** → badge disappears, grid state re-syncs
- [ ] Cells filled during the offline window (if any were queued) should sync to the server
  - **⚠️ Known limitation:** PLAN-R14 (disconnect recovery) is not fully verified yet — expect some rough edges

### 6.5 Server restart mid-competition

- [ ] Everyone connected, round in progress
- [ ] `Ctrl+C` the server, wait 3 s, restart
- [ ] Every browser reconnects automatically within 10 s
- [ ] Grid state is preserved server-side (came from the DB, not memory)

---

## 7. Security spot-checks

These are quick manual verifications of things automated tests don't catch.

### 7.1 Response headers

Run in PowerShell:
```powershell
Invoke-WebRequest -UseBasicParsing -Method Head http://localhost:3001/api/health | Select-Object -ExpandProperty Headers
```
- [ ] `Content-Security-Policy` present
- [ ] `X-Frame-Options: DENY` present
- [ ] `X-Content-Type-Options: nosniff` present
- [ ] `Referrer-Policy` present
- [ ] `Strict-Transport-Security` (only if HTTPS)

### 7.2 Auth boundaries

- [ ] Call an authenticated endpoint without a token → returns `40101 未授权` (401)
- [ ] Call with a garbage token → returns `40102 Token无效或已过期` (401)
- [ ] Call `/api/competitions/{id-of-other-org}` with a valid token → returns `40403` or `40301` (never the data)

### 7.3 Injection tests

- [ ] Create a competition with name `'; DROP TABLE users;--` — the name is stored as literal text (Prisma parameterizes), and `users` table still exists (verify with `SELECT COUNT(*) FROM users;`)
- [ ] Create a competition with name `<script>alert(1)</script>` — the name renders as plain text in the UI, no popup fires
- [ ] Same test for participant name

### 7.4 Rate limits

- [ ] From DevTools Console, loop 250 POST requests to `/api/auth/login` in 1 min → the first ~200 pass, the rest get `429 Too Many Requests`
- [ ] Wait 15 min → login works again (window reset)

---

## 8. Pre-production checklist

Before opening the app to real competitors:

- [ ] **ISSUE-018** — production secrets rotated and removed from git history (**human action**, not automatable)
- [ ] **ISSUE-014** — round auto-stops when the timer expires (**Sylvain**, engine fix)
- [ ] **ISSUE-033** — 11 GameOrchestrator team-stage tests pass (**Sylvain**)
- [ ] **This guide, Section 1–6** — every scenario ticked at least once
- [ ] **This guide, Section 7** — all security spot-checks green
- [ ] Server: `NODE_ENV=production`
- [ ] Server: new `JWT_SECRET` (32+ random chars) different from dev
- [ ] Server: `.env.production` generated fresh on the target host, never copied from git
- [ ] HTTPS on the client side (nginx or Caddy reverse-proxy)
- [ ] Automated database backups scheduled (daily at minimum)
- [ ] Uptime + 5xx error monitoring in place (any provider — UptimeRobot, Grafana Cloud, whatever)

Until every box above is ticked, do NOT open to public users. A live
competition with 30 kids and a broken timer is a nightmare recovery.

---

## Appendix — What automated tests already cover (you can skip these manually)

- Server: 33 test suites, 524 tests — every route's auth gate, every repository's
  tenant filter, every service's happy path and error envelope. Run with
  `cd server; npm test`.
- Client: 36 test suites, 367 tests — every page's render, every form's happy
  path, every dashboard's data-load flow. Run with `cd client; npm test -- --run`.
- Lint: `cd client; npm run lint` — should output nothing (0 warnings as of
  2026-08-25).

If a red test appears, DO NOT continue manual testing until it's fixed —
whatever you're chasing is probably a symptom of the same root cause.
