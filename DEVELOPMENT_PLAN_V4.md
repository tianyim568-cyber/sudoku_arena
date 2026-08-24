# Development Plan v4 — End-to-End Product Audit

> **Written:** 2026-08-24, from branch `louise` at commit `fb9e2da`
> (merged with `main` at `69971b1`).
>
> **What v4 is, and why it exists on top of v3:**
> v3 catalogued the **119 individual functionalities** listed in the two
> earlier plans (`DEVELOPMENT_PLAN.md` and `development_plan_v2.md`) with a
> ✅/⚠️/❌ per row. v4 does something different — it walks through the
> four **canonical user flows** end-to-end, points at exactly what breaks
> in each, and hands Louise a testable scenario list she can play by
> hand before the meeting with Sylvain.
>
> **The core question v4 answers:** "If I sit down as an org admin,
> judge, player, or big-screen operator and try to use the platform end
> to end, what actually works, what breaks, and what feels wrong?"

---

## 1. Product vision — one page

A multi-tenant SaaS for running Sudoku competitions. Organizations are
provisioned manually (no billing in MVP). Each organization is
data-isolated (`organization_id` on every scoped table + `tenantGuard`
middleware). Four roles: SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER.

A **competition** is a sequence of **stages** (INDIVIDUAL or TEAM; PK
declared but not implemented). A stage is a sequence of **rounds** (6
round types total: three per stage kind). Rounds auto-progress inside a
stage (preparation countdown → round → transition → next round). Stages
DO NOT auto-progress — the judge clicks "start next stage".

Timers, scoring, and rankings are **server-authoritative**. Client
displays what the server sends; it never computes a score by itself.

The **big screen** is a public read-only display driven by a temporary
token. The judge controls its display mode from the judge console (5
modes: DEFAULT, LIVE_RANKING, ROUND_RANKING, STAGE_RANKING,
FINAL_RANKING) plus a projection of one specific player
(PLAYER_BROADCAST) triggered from the monitoring panel.

Two UI languages: **Chinese (default) and English** — no French anywhere
in the user-visible product. Verified 2026-08-24 (see §6.1).

**The whole product is scoped for on-site competitions in Chinese
schools.** Public UI is Chinese by default; English is the second lane
for foreign admins and reviewers. Big-screen views are Chinese-only on
purpose (audience is always Chinese in the room).

---

## 2. The four user flows — status walk-through

Legend for each step below:
`✅` works end-to-end · `⚠️` works but with a caveat/bug · `❌` broken /
missing · `📝` product decision needed (not code).

### 2.1 Organization Admin flow

Journey per v1 §5:
`Register → Login → Dashboard → Create Competition → Configure Stages/Rounds → Import Participants → Generate Credentials → Create Judges → Assign Judges → Import Puzzles → Assign to Rounds → Publish → Monitor → View Results`

| Step | Status | Evidence / Gap |
|---|---|---|
| Register org + admin atomically | ✅ | `POST /auth/register` creates org + user in one transaction. |
| Login → org-scoped JWT | ✅ | JWT carries `organizationId`. |
| Dashboard landing | ✅ | `/dashboard` with sidebar (Competitions, Puzzle Bank, Participants, Judges, Teams, Results). |
| Create competition | ✅ | `DashboardCompetitionsPage` "+ New competition". |
| Configure stages | ✅ | Inside `CompetitionDetailPage`. Add/remove stages, one type at a time. |
| Configure rounds within a stage | ✅ | Name, type, duration, preparation seconds (with 5-min cap). |
| Import participants via Excel | ✅ | Upload → preview → confirm → auto team creation from Excel column. |
| Auto-generated credentials + export | ✅ | XLSX export from the same page. |
| **Create a judge** | ✅ | `DashboardJudgesPage` (2026-08-23) — creates via `POST /users` with `role: 'JUDGE'`, shows credentials once in a banner. |
| **Assign an existing judge to a competition** | ⚠️ **BUG** | `CompetitionDetailPage:handleAssignJudge` calls `users.find(u => u.role === 'JUDGE')` — assigns the **first judge in the org**, no picker. If 3 judges exist, only the 1st can ever be assigned. See §5 (bug list). |
| Import puzzles from the bank into a round | ✅ | `DashboardPuzzleBankPage:handleImport` with a round dropdown. |
| Import puzzles from PDF | ❌ | Sample PDF landed 2026-08-23; **Sylvain owns the task**, nothing shipped yet. |
| Publish competition | ✅ | `PublishPanel` + `POST /:id/publish` + `PublishabilityService`. |
| Unpublish (destroy the access link) | ✅ | `POST /:id/unpublish`. |
| Post-publish: adding stages/rounds locked | ⚠️ | The engine still permits stage config in `PUBLISHED` state (documented in Louise/POINTS_POUR_SYLVAIN §14bis). Not tightened. Sylvain's file to change. |
| Generate access link (post-publish) | ✅ | `AccessLinkSection` on the detail page — copy, regen with confirm. |
| Generate big-screen display token | ✅ | `DisplayTokenSection` on the judge console. |
| Live monitoring during competition | ✅ | `JudgeMonitoringPanel` on the judge console. |
| View historical results | ✅ | `/dashboard/results` — round tabs + Final tab, category filter (added 2026-08-23). |
| **Global participants view** | ✅ | `/dashboard/participants` (2026-08-23) — cross-competition list, three filters, org-scoped by server WHERE clause. |
| Super Admin dashboard | ✅ | `/admin` (2026-08-23) — org list, competition list, stats. Read-only. |

### 2.2 Judge flow

| Step | Status | Evidence / Gap |
|---|---|---|
| Enter via `/competition/<accessCode>` | ✅ | Public entry page. |
| Login as judge | ✅ | Competition-scoped JWT. |
| See judge control panel | ✅ | `JudgeControlPage`. |
| Start competition | ✅ | Button visible on `PUBLISHED`. |
| Start a stage | ✅ | Stage controls block. |
| Auto-progress rounds within a stage | ✅ | Handled by `GameOrchestrator`. |
| End a round early | ✅ | Button per round while running. |
| Pause / resume competition | ✅ | Buttons on `RUNNING`. |
| Round auto-ends on timer expiry with proper WS emissions (ISSUE-014) | ✅ | Fixed + real test committed 2026-08-23. |
| Live monitoring (participant list) | ✅ | `JudgeMonitoringPanel`. |
| Per-player detail view | ✅ | `JudgeLivePlayerView` — grid, status. |
| Score / age / category shown in monitoring detail | ❌ | `GET /monitoring/participants` still returns only presence + identity. Sylvain's route. |
| Broadcast a player to big screen | ⚠️ | Backend route requires ORG_ADMIN role (not JUDGE). A judge sees an explanatory note instead of the button. **Product decision needed** — should a JUDGE be allowed to project? |
| Change big-screen mode (5 buttons) | ✅ | `DisplayModeControls` — Default, Live, Round, Stage, Final. Only ORG_ADMIN can click; a judge sees the current mode read-only. |
| Start the next stage | ✅ | "Next stage" button. |
| End competition | ✅ | Button. |

### 2.3 Player flow

| Step | Status | Evidence / Gap |
|---|---|---|
| Enter via `/competition/<accessCode>` | ✅ | Same public entry as judge. |
| Login as player | ✅ | Competition-scoped JWT. |
| Waiting screen before start | ✅ | `WaitingScreen`. |
| Preparation screen with countdown + rules | ✅ | `PreparationScreen` (2026-08-23 wired). |
| Round auto-starts after prep | ✅ | Server drives the transition. |
| Timer visible + smooth | ✅ | `useTimer` uses rAF + server tick recalibration. |
| Player auto-save (grid persists across refresh) | ✅ | `disconnect-recovery.test.js` covers save + restore. |
| Round-to-round transition screen | ✅ | `TransitionScreen`. |
| **End-of-stage screen** | ✅ | `StageFinishedScreen` variant `'stage'` (2026-08-23). |
| Wait for next stage (judge decides) | ✅ | Same StageFinishedScreen — "waiting for the judge…". |
| Second stage plays through the same flow | ✅ | Round engines already integrated with StageManager. |
| **End-of-competition screen** | ✅ | `StageFinishedScreen` variant `'competition'`. |
| Player sees rankings / score mid-competition | ❌ (intentional) | 2026-08-15 product decision — no mid-competition scores/rankings for players. |
| Player sees their score after the competition | ❌ | No page shows a player their result. Deferred: maybe not needed for on-site MVP. **Product decision needed.** |

### 2.4 Big Screen flow

| Step | Status | Evidence / Gap |
|---|---|---|
| Judge generates a display token | ✅ | `DisplayTokenSection` — copies URL. |
| Operator opens `/display/<token>` | ✅ | Public page, no user account needed. |
| Ranking snapshot polling (5s) | ✅ | Fallback for socket-less environments. |
| WebSocket for live updates | ✅ | `SocketManager` broadcasts on `RANKING_UPDATE`, `DISPLAY_MODE_CHANGED`, `DISPLAY_PLAYER_BROADCAST`. |
| DEFAULT view | ✅ | Full ranking grid + stage-round nav. |
| LIVE_RANKING view | ✅ | Same file, mode-aware. |
| ROUND_RANKING view | ✅ | `RoundRankingView` — auto-selects the live-or-most-recent round. |
| PLAYER_BROADCAST view | ✅ | `BroadcastView` — full-screen focus on one player's grid. |
| STAGE_RANKING view | ✅ | `DisplayStageRankingView` (2026-08-23) — aggregate of the current/last stage. |
| FINAL_RANKING view | ✅ | `DisplayFinalRankingView` (2026-08-23) — top-3 podium + rest cap 20. |
| Token revocation kills the connection | ✅ | Ticket TTL + explicit revoke path. |
| Reconnection after network blip | ✅ | 5s poll fallback picks up snapshot. |

**Note on Chinese-only labels here:** the four big-screen views
(`RankingView`, `RoundRankingView`, `DisplayStageRankingView`,
`DisplayFinalRankingView`) plus `BroadcastView` and the top-level
`DisplayPage` error/loading text are **intentionally hardcoded in
Chinese**. The audience in the room is always Chinese; the language
toggle is not offered here on purpose. Documented in each component's
docstring.

---

## 3. Real bugs and rough edges found during this audit

> **Update 2026-08-24 — LIVE UI walkthrough.** After a code-only
> pass, I sat down at a running dev server and drove the app as an
> ORG_ADMIN. Two P0 bugs surfaced that a code trace alone missed —
> both were bugs *in features I had just shipped*. Both fixed the
> same day (commits `c5f38f6`). More bugs and rough edges below.

### 3.1 P0 (blocked or discovered by live test)

- ✅ **BUG-06 (FIXED)** — Create-judge for ORG_ADMIN.
  `POST /api/users` compared the raw `req.body.organizationId`
  against `req.user.organizationId` *before* resolving
  `effectiveOrgId`. The dashboard's judge-creation UI never sends
  `organizationId` (it relies on the server auto-assigning the
  caller's org), so every ORG_ADMIN attempt was rejected with 40301
  "You cannot create a user in this organization". **My freshly-
  shipped judges page was unusable for the very role it was built
  for.** Fixed in commit `c5f38f6`: resolve effectiveOrgId first,
  then compare. Regression test added — omitting the field is now
  the *tested* happy path.
- ✅ **BUG-05 (FIXED)** — Import-from-bank sent `count: 0`.
  The Zod schema on the server is
  `z.coerce.number().int().positive().optional()`, which rejects
  0 with "Too small: expected number to be >0" — a Zod-internal
  message displayed verbatim to the admin. Fixed in commit
  `c5f38f6`: the client now omits the field (the service already
  treats it as "all available" for team rounds).

### 3.2 P1 (open, from the live walk-through)

- **BUG-01 — Assign judge picker is broken.**
  `CompetitionDetailPage:handleAssignJudge` (line 155-161) hard-picks
  `users.find(u => u.role === 'JUDGE')` — always the same judge if the
  org has several. Needs a real dropdown of unassigned JUDGE users
  inside the competition detail page. **Louise-side.**
- **BUG-02 — Publish panel doesn't refresh after inline edits.**
  Add a stage or a round from the competition detail page and the
  "Publishing" checklist keeps the state it had at load time. The
  admin has to reload to see the check flip. **Louise-side**
  (`CompetitionDetailPage` needs to re-fetch publishability after
  each mutation). Confirmed live during the audit.
- **BUG-03 — Round display shows raw enum, not the friendly label.**
  Inside a stage's rounds list, each round card reads
  `Type: INDIVIDUAL_STANDARD | Duration: 60s | Puzzles: 0` — the
  ENUM value, not "Standard Sudoku". The i18n key
  `common.roundName.INDIVIDUAL_STANDARD` exists and is used elsewhere
  (dropdown labels). **Louise-side** — 1-line fix in
  `CompetitionDetailPage`. Confirmed live.
- **BUG-04 / F88 (unrelated but adjacent) — No way to generate
  individual-round puzzles from the UI.** The puzzle bank page only
  offers R1/R2/R3 generation buttons (all TEAM rounds). An admin
  who creates an INDIVIDUAL stage cannot populate its rounds through
  the UI. The server's `importToRound` for individual round types
  reads `bank.puzzles.filter(p => p.roundType === type)` — but
  nothing writes `INDIVIDUAL_*` typed puzzles to the bank. **The
  individual-round happy path is broken end-to-end.** This is
  distinct from F88 (PDF import, Sylvain's task). Needs a product
  decision: is F88 supposed to solve this, or do we need a separate
  "generate individual sudoku" button? Confirmed live.
- **F65 — Score/age/category in monitoring payload.** `/monitoring/
  participants` returns presence + identity only. **Sylvain-side.**
- **F107 — ~33 remaining `console.*` in Sylvain's files.**
  **Sylvain-side.**
- **F88 — PDF import service.** Sylvain took the task; nothing
  shipped yet. **Sylvain-side.**
- **ISSUE-018 — Rotation of the exposed prod secrets.**
  `.env.production` untracked going forward, but the values already
  in history need to be rotated. **Human action.**
- **ISSUE-019 — Per-IP rate limit blocks a whole competition room.**
  `authLimiter` (30 logins / 15 min / IP) refuses legitimate
  players behind one NAT. **Design decision + Sylvain.**

### 3.3 P2 / A11y / rough edges (found live)

- **Stage-type buttons have no accessible name.** When the admin
  clicks "+ Add a stage", the two enabled options (INDIVIDUAL /
  TEAM) render as `<button>` with content that isn't picked up as
  an accessible name — a screen reader announces "button, button".
  Third option ("Head-to-head stages are not available yet") does
  have a name because it's disabled with a title. **Louise-side.**
- **Round-form file input has no accessible name.** The "Puzzle
  file (PDF)" input in the round creation form is a bare `<input
  type="file">` — screen reader announces "button" with no label.
  **Louise-side.**
- **Round-list header shows "Round 1 Round 1 quick test"** — the
  round order label ("Round 1") and the round name ("Round 1
  quick test") sit side by side with no separator. Minor visual.
  **Louise-side.**
- **Puzzle-bank generation alert says "The bank now has 396"**
  after a freshly-registered org generates 10 puzzles. The count
  is coming from the shared JSON bank file, not the org-scoped
  view — the alert message is misleading. ISSUE-025 tracks this
  design flaw at the storage level (flat JSON file, unbounded
  growth); the misleading alert is a symptom. **Louise-side.**
- **Vacuous ✓ in the publish checklist when nothing is configured.**
  Before any stage exists, "Every stage has at least one round" and
  "Every round has at least one puzzle" show ✓ (technically
  vacuously true). Reads as "2/5 already done" to a new admin. Once
  BUG-02 (stale panel) is fixed, this UX quirk also disappears —
  the check will flip to ✗ as soon as a stage without rounds is
  added, which is honest. **Louise-side.**
- Post-publish stage config lock (F26) — engine still allows
  reshaping. **Sylvain-side.**
- End-of-competition player screen shows only "thanks for taking
  part" — no view of their own result. **Product decision.**
- Broadcast player: only ORG_ADMIN, not JUDGE. **Product decision.**
- `dashboard.superAdminComingSoon` i18n key unreferenced. Dead
  code.
- `louise/` (lowercase) folder is a case-insensitive duplicate of
  `Louise/` on Windows.

### 3.4 Confirmed non-issues (assumed by design)

- Chinese hardcoded in the big-screen views — documented product
  decision (audience is Chinese in the room).
- Chinese `display_name` for demo users (管理员, 裁判, 选手1..8) — DB
  seed data, WONTFIX (ISSUE-007).
- `无法发布：${summary}` server error is untranslatable via the
  exact-string i18n table — dynamic message, ISSUE-037 documents
  the limitation.
- Suite passes: server 462/462, client 354/354 as of 2026-08-23
  evening (v3 merge commit `69971b1`). Baseline for regression watch.

---

## 4. What's not Louise's

The pieces of the MVP that will not close from Louise's side and
depend on Sylvain (or a team decision):

| Item | Who | Notes |
|---|---|---|
| F65 monitoring payload enrichment | Sylvain | `routes/monitoring.js` |
| F88 PDF import (service + endpoint + UI hookup) | Sylvain | He took it after the sample PDF landed |
| F107 `console.*` → Pino in his files | Sylvain | Purely mechanical |
| F26 lock stage config once PUBLISHED | Sylvain | `engine/StageManager.configureStages` |
| ISSUE-018 secret rotation | Team | Cannot be automated by an assistant |
| ISSUE-019 rate-limit keying | Team decision + Sylvain | Choose per-user vs raise-ceiling vs trust-proxy |
| BUG-01 broadcast-player role gate | Team decision | Whether JUDGE can project — needs product call |
| F114 full 40-step live E2E | Both | To be played by hand once all above land |

---

## 5. Testable scenarios for Louise

Sit down at the platform with two browser windows (one for the admin,
one for the player/judge/display), and play these end-to-end. Each
scenario says which pieces should work today and which will break — so
you can tell the difference between "the platform is buggy" and
"you're hitting a known gap".

### Scenario A — Full happy path (org admin, single stage, one player)

**Setup:** dev server running (`cd server; npm run dev` +
`cd client; npm run dev`), admin/admin123, player1/player123.

1. **Login as `admin`** → lands on `/dashboard`. ✅ should work.
2. **Create a competition** "Test Cup A" → appears in the list. ✅
3. **Open its detail page** → see the stages block. ✅
4. **Add an INDIVIDUAL stage.** ✅
5. **Configure the stage** → add one round (type `INDIVIDUAL_STANDARD`,
   60s duration, 5s prep). ✅
6. **Go to `/dashboard/puzzle-bank`** → generate/import puzzles.
   ✅ (works for R1/R2/R3; individual-round puzzles use the same bank).
7. **Back to the competition detail** → import puzzles from bank into
   the round. ✅
8. **Import a single-player Excel** (or use the seeded `player1`).
   For the seeded flow: `POST /api/competitions/:id/teams` already OK
   without team-first because F28 auto-team-creates from Excel; a
   solo player can be imported directly. ✅
9. **Publish the competition** → publish panel accepts. ✅
10. **Generate the access link** on the detail page → copy the URL. ✅
11. **Open the URL in a private window** → competition entry page. ✅
12. **Log in as `player1` / `player123`** → `WaitingScreen`. ✅
13. **Back to the admin/judge console** → start the competition. ✅
14. **Start the stage** → the player's screen switches to
    `PreparationScreen` with countdown. ✅
15. **Round begins** → player sees the puzzle grid. ✅
16. **Player types answers** → auto-save (refresh the page,
    progress restored). ✅
17. **Wait for the timer to expire** OR **judge clicks "end round"** →
    `TransitionScreen` if another round follows, else
    `StageFinishedScreen` variant `'stage'`. ✅
18. **Admin ends the competition** → player sees
    `StageFinishedScreen` variant `'competition'`. ✅

**Everything in Scenario A should work today.** If any step fails,
that's a real regression.

### Scenario B — Big-screen operator

Requires Scenario A already running.

1. On the judge console, click **"generate display token"** →
   `DisplayTokenSection` shows a URL. ✅
2. Open the URL in a third window → `DisplayPage` mounts, shows
   `RankingView` (DEFAULT mode). ✅
3. From the judge console, use the mode buttons: **Live ranking,
   Round ranking, Stage ranking, Final ranking**. The big-screen
   window switches views. ✅
4. From the monitoring panel, **click "project" on a player** (admin
   only). The big screen shows `BroadcastView`. ✅ if you're admin,
   ⚠️ if you're logged in as a plain JUDGE (button hidden).

**Everything works.** The "judge cannot project" is on purpose today —
part of the product decision list.

### Scenario C — Multi-stage flow (INDIVIDUAL then TEAM)

Same as A, but add a second stage (TEAM) with round R1.

- Between the two stages, the player sees `StageFinishedScreen`
  variant `'stage'` ("Stage 1 finished — waiting for the judge").
  ✅
- Admin clicks "Start next stage" → player switches to
  `PreparationScreen` of stage 2 round 1. ✅
- After the TEAM stage finishes and the admin clicks "End
  competition", the player sees `StageFinishedScreen` variant
  `'competition'` ("Competition finished — thanks for taking
  part"). ✅

### Scenario D — Multi-judge assignment (the known bug)

1. Create 3 judges via `/dashboard/judges` (`judge_a`, `judge_b`,
   `judge_c`).
2. Create a competition.
3. Click "Assign judge" on the competition detail page.
4. **Expected:** you get to pick which judge.
5. **Actual:** the first judge alphabetically (whoever `users.find`
   returns first) is assigned. **BUG-01.**

**This is the real bug this audit found.** Louise-side fix, small
(replace the auto-pick with a dropdown of unassigned org judges).

### Scenario E — English language mode

1. Click the language switcher (top of the page) — flips to `EN`.
2. Every visible label should be in English **except** the big-screen
   views (`/display/*`) which stay in Chinese by design.
3. When the server rejects (e.g., wrong password), the error banner
   should show **English** text (`translateServerMessage` handles
   it — 117 keys covered as of 2026-08-23).
4. The dynamic publish-check error `无法发布：<missing items>` stays
   in Chinese even in EN mode — documented limitation (ISSUE-037).

### Scenario F — Multi-tenant sanity check (advanced)

Two org admins in two different orgs (register two accounts, two
orgs).

1. Org A admin creates a competition + imports participants.
2. Org B admin logs in, opens `/dashboard/participants` and
   `/dashboard/competitions`.
3. **Expected:** none of Org A's data is visible from B.
4. Enforced server-side by `tenantGuard` and by the `WHERE
   competitions.organization_id = req.user.organizationId` clause
   on `GET /participants`. Verified with dedicated tests.

### Scenario G — What will NOT work (known gaps)

- Assigning judge B when judge A is already assigned → **BUG-01**
  (only A can ever be picked).
- Judge trying to broadcast a player → 403 (documented, ORG_ADMIN
  only).
- Judge seeing player scores in the monitoring detail → **F65**
  (missing on Sylvain's side).
- Importing a puzzle PDF → **F88** (Sylvain's task, not shipped).
- End-of-competition player screen showing your own result → not
  built (product decision needed).

---

## 6. Language / translation audit (2026-08-24)

### 6.1 French-in-UI scan
- Scanned every `.jsx`/`.js`/`.json` file under `client/src` and
  `server/src` for French-only characters and words.
- **User-visible French: zero.** No leaks in i18n dictionaries, no
  hardcoded French in JSX text or strings.
- Two French comments were found in
  `client/src/i18n/LanguageContext.jsx` (violation of the
  "English-only comments" rule) — fixed 2026-08-24.

### 6.2 English/Chinese dictionary parity
- `client/src/test/i18n.test.js` enforces:
  1. `en.js` and `zh.js` have the same key set (no orphan on either
     side).
  2. Neither file has duplicate keys (this catches the bug class of
     ISSUE-028: a JS object literal silently keeps only the last
     value if a key repeats).
- Both tests pass as of the last suite run.

### 6.3 Server-error i18n table (`serverMessages.js`)
- 117 exact-string mappings from Chinese to English.
- Every Chinese `message: '...'` literal across `server/src` has a
  matching entry — **except one**: `无法发布：${summary}` is built
  from a runtime concat and cannot be matched by exact strings.
  Documented limitation (ISSUE-037).

### 6.4 Chinese hardcoded on purpose
- 5 big-screen files (`RankingView`, `RoundRankingView`,
  `DisplayStageRankingView`, `DisplayFinalRankingView`,
  `BroadcastView`) plus `DisplayPage` error/loading text: **Chinese
  hardcoded by design**, no i18n. Documented in each docstring. The
  audience of the big screen is always Chinese in the room.
- `LanguageSwitcher` displays "中文" as the toggle label (unavoidable —
  the toggle offers the OTHER language).

### 6.5 What is deliberately NOT translated
- DB `display_name` for demo users (`管理员`, `裁判`, `选手1..8`) —
  WONTFIX ISSUE-007. Seed data stays Chinese even in EN mode.
- The `无法发布：${summary}` runtime concat (ISSUE-037).

---

## 7. UX quality — "does it feel real, natural, smooth?"

An honest read from the code, not from a live session (I have not run
the app on a real screen this pass — see §8):

- **Player flow feels right.** Waiting → prep countdown → play →
  transition → next round → stage-end → competition-end. Each
  screen has a clear job, no dead-end. Timer is smooth (rAF +
  server tick recalibration).
- **Judge flow is functional but crowded.** Stage controls,
  monitoring panel, display token + mode buttons, participant
  projection all live on one page. Works, but a real judge may
  need a second monitor to see everything at once. Not fixed here.
- **Admin flow is dense.** `CompetitionDetailPage` mixes stages,
  rounds, teams, judges, participants, publish, access link. It
  works, but that page could easily become "the page where you do
  everything" — a proper wizard for first-time setup would help
  first-time admins.
- **Big screen is clean.** Podium visual has real weight, empty
  states are honest, mode transitions do not blank the screen.
- **Errors surface where they should.** Every API call goes
  through `translateServerMessage`, so an English admin sees
  English errors. The client's `parseResponse` wraps
  `res.text() + JSON.parse` so a server that returns HTML or an
  empty body does not throw an uncaught rejection.
- **The one UX bug found this pass:** BUG-01 assign-judge is a
  hidden "the button doesn't do what you think" trap. An admin who
  creates 3 judges cannot understand why only judge_a ever appears
  on the competition.

---

## 8. What v4 does NOT cover (be honest)

- ~~A live end-to-end session in the browser.~~ ✅ **Done
  2026-08-24 evening** — an ORG_ADMIN walk-through from
  registration through stage config surfaced BUG-01 through BUG-06
  documented above.
- **Full player + judge live session.** The live pass stopped at
  "admin cannot populate an INDIVIDUAL round from the UI"
  (BUG-04) — beyond that, playing as a judge and a player would
  need real puzzles seeded through a different path. Deferred
  until BUG-04 (or F88) lands.
- **Load testing.** No test of "100 players connecting at once".
  ISSUE-019 (rate limit) hints at a real problem but has not been
  reproduced.
- **Accessibility.** Two issues surfaced in the live pass (unlabeled
  stage-type buttons, unlabeled file input) but there was no
  systematic axe scan, no keyboard-only walkthrough, no screen-
  reader check.
- **Mobile responsive on real devices.** The dashboard uses
  responsive Tailwind classes; behaviour on a real phone is
  untested this pass.

---

## 9. Next steps

**Already done during the 2026-08-24 audit:**
- ✅ BUG-05 (import-from-bank count=0) — fixed + shipped in `c5f38f6`.
- ✅ BUG-06 (create-judge for ORG_ADMIN) — fixed + shipped +
   regression test in `c5f38f6`.
- ✅ Full French-in-UI scan — zero user-visible French leaks
   (2 code comments in `LanguageContext.jsx` fixed in `dc493af`).
- ✅ Live UI walkthrough from admin registration through stage
   config — surfaced BUG-01 through BUG-04 above.

**Louise, next:**
1. Fix **BUG-01** (assign judge picker) — small, self-contained,
   client-only.
2. Fix **BUG-02** (publish panel doesn't refresh) — refetch
   publishability after each stage/round/participant/judge mutation.
3. Fix **BUG-03** (raw enum in round list) — 1-line i18n swap.
4. Fix the two a11y issues (stage-type buttons + file input labels).
5. **BUG-04** (individual round puzzle flow) — needs a product
   decision first: is F88 (PDF import) supposed to cover this, or
   should the puzzle bank grow an "Individual sudoku generator"
   button too? Discuss with Sylvain.

**Team meeting with Sylvain:**
1. Confirm his ETA on F88 (PDF), F65 (monitoring payload),
   F107 (console cleanup), F26 (post-publish lock).
2. Decide ISSUE-018 secret rotation plan.
3. Decide ISSUE-019 rate limit approach.
4. Decide whether a JUDGE can broadcast a player.
5. Decide whether the player sees their own result at the end.

**Ship gate:**
Run F114 (full 40-step live simulation) once all of the above land.
That is the MVP gate.

---

*This file is a snapshot as of 2026-08-24, based on the code at
commit `fb9e2da` on branch `louise` (equivalent to `main` at
`69971b1` plus the plan-v3 refresh). Meant to be shown to Sylvain to
align on what remains. `Louise/JOURNAL_MODIFICATIONS.md`,
`Louise/KNOWN_ISSUES.md` and `Louise/POINTS_POUR_SYLVAIN.md` remain
the authoritative day-to-day tracking files.*
