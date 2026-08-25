# Sudoku Arena

**Multi-tenant SaaS platform for real-time Sudoku competitions.**

A running Sudoku tournament, live in a room. An org admin sets up a competition, a
judge runs it from a console, players play from their laptops, and a big screen on
the wall shows live rankings. Every organization sees only its own data.

Chinese-first UI with a ZH ↔ EN language switcher.

## What's inside

```
sudoku_arena/
├── client/                 React 19 + Vite + Tailwind (plain JS, no TS)
│   ├── src/pages/          route-level pages (dashboard, judge console, player, display)
│   ├── src/components/     UI components (ranking views, panels, forms)
│   ├── src/hooks/          useAuth (JWT), useGameSocket (WS), etc.
│   └── src/i18n/           ZH + EN dictionaries (parity checked by a test)
├── server/                 Node/Express + Socket.IO + PostgreSQL
│   ├── src/routes/         HTTP route handlers, one file per resource
│   ├── src/middleware/     auth (JWT), tenantGuard (org isolation), validate (Zod), rateLimiters
│   ├── src/engine/         GameOrchestrator + StageManager + DisplayManager (game state)
│   ├── src/db/             Prisma client + repositories (all DB access)
│   ├── src/ws/             EmissionBus + SocketManager (real-time)
│   └── prisma/             schema.prisma + numbered migrations
├── docs/                   Spec (Chinese, 2026-07-10) + MANUAL_TESTING_GUIDE.md
├── deploy/                 Alibaba Cloud install scripts (nginx, systemd, quick-deploy)
└── development_plan_v2.md  Current 7-day plan (source of truth for what's next)
```

## Stack

- **Frontend:** React 19 (hooks, no Zustand), Vite 7, Tailwind CSS 4, `react-router-dom` 7, plain JavaScript. Client tests: Vitest + React Testing Library.
- **Backend:** Node 18+, Express, Socket.IO, Prisma ORM 6, PostgreSQL, Zod for input validation, JWT for auth. Server tests: Jest + Supertest.
- **Language:** Chinese default with an English toggle (client-side, `LanguageContext`). Server error messages are also translated on the client via `serverMessages.js`.

## Quick start (local dev)

Prerequisites: **Node 18+**, **PostgreSQL 14+** (or Docker), **npm** or **pnpm**.

```powershell
# 1. Install dependencies (once)
cd server; npm install
cd ../client; npm install

# 2. Set up the database (once — creates DATABASE_URL in server/.env)
cd ../server
cp .env.example .env         # edit DATABASE_URL to match your local PG
npx prisma migrate deploy    # apply all migrations
npx prisma db seed           # seed demo accounts + orgs

# 3. Start both processes (two terminals)
# Terminal A — server (port 3001):
cd server; npm run dev
# Terminal B — client (port 5173):
cd client; npm run dev

# 4. Open http://localhost:5173
```

**Windows note:** if `npx prisma generate` errors with a DLL lock, stop `npm run dev` first (the running Node process holds the client bundle open), then re-run.

## Demo accounts (from the seed)

| Role | Username | Password | Where they land |
|---|---|---|---|
| **SUPER_ADMIN** | `admin` | `admin123` | `/dashboard` — platform overview, all orgs |
| **JUDGE** | `judge` | `judge123` | `/dashboard/competitions` — competitions assigned to them |
| **PLAYER** | `player1` … `player8` | `player123` | `/competitions` — public list, join via access link |

**ORG_ADMIN** accounts are created from the SUPER_ADMIN's Users page — no seeded one.

## Tests & lint

```powershell
cd server; npm test                # 524 tests, ~30s
cd client; npm test -- --run       # 367 tests, ~5 min
cd client; npm run lint            # oxlint, expected: 0 warnings
```

If anything reports red, don't ship. The `MANUAL_TESTING_GUIDE.md` §8 pre-production
checklist won't accept it either.

## Roles at a glance

- **SUPER_ADMIN** — owns the platform. Creates and manages organizations. Never runs a competition themselves.
- **ORG_ADMIN** — owns one organization. Creates competitions, imports participants, assigns judges, publishes.
- **JUDGE** — runs one or several assigned competitions. Starts/pauses/ends rounds, monitors live scores, controls the big screen.
- **PLAYER** — competes. Joins via an access link, plays Round 1 / 2 / 3, sees only their own results (rankings during the competition are hidden by design — decision of 2026-08-24).

## Where to read next

- **[docs/MANUAL_TESTING_GUIDE.md](docs/MANUAL_TESTING_GUIDE.md)** — pre-flight checklist by role. Do this before opening the app to real competitors.
- **[BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md)** — server architecture, routes, tenant isolation model. See the "August 2026 Updates" section at the top for current state (the body is partly obsolete).
- **[FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md)** — client architecture, hooks, i18n. Same rule as above: trust the top section.
- **[docs/README.md](docs/README.md)** — the original spec (Chinese, 2026-07-10). Warning header at top flags where the code diverged from it.
- **[development_plan_v2.md](development_plan_v2.md)** — Sylvain's 7-day plan. This is what governs "what's next" for the two-agent workflow.

## Status

**Not production-ready yet.** Baseline is green (891 tests pass, 0 lint warnings), and
the UI works end-to-end in dev, but three HIGH blockers must be cleared before opening
to real competitors:

- **ISSUE-014** — round doesn't auto-stop when the timer expires (engine fix, owner: Sylvain).
- **ISSUE-018** — production secrets committed to git history (human action: rotate the secrets + scrub history).
- **PLAN-R17** — the 40-step live E2E has never been run end-to-end with real browsers.

See `docs/MANUAL_TESTING_GUIDE.md` §8 for the full pre-production checklist.

## Deployment

Alibaba Cloud is the current target. Scripts are in `deploy/`:

- `deploy/quick-deploy.sh` — one-shot Ubuntu 22.04 install (nginx + PostgreSQL + systemd + node). Generates a random DB password; the host is passed in via `DEPLOY_HOST=your.host.tld`.
- `deploy/deploy.sh` — incremental deploy (pull + migrate + restart).
- `deploy/nginx-sudoku-arena.conf` — reverse proxy config template. `__DEPLOY_HOST__` is substituted at install time.

**Do not deploy** until ISSUE-018 is closed and the pre-production checklist is green.

## License

Proprietary — internal project. Not for public redistribution.
