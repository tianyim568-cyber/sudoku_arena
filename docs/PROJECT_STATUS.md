# Sudoku Arena — Project Status

> **Last updated:** 2026-08-25
> **Branch:** main

---

## Summary

Sudoku Arena is a multi-tenant SaaS platform for organizing and running live sudoku competitions. The system supports individual and team rounds, real-time scoring via WebSocket, big-screen projection, and multi-language (EN/ZH) interfaces. The project has been through extensive development including security hardening, performance optimization, and feature completion.

---

## Completed Features

### Core Platform
- Multi-tenant architecture with organization-level isolation
- Role-based access control (SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER)
- JWT authentication with bcrypt password hashing
- Rate limiting on auth and expensive endpoints
- i18n (English + Chinese) across all views

### Competition Lifecycle
- Create, configure, publish, start, pause, resume, end competitions
- Stage-based structure (INDIVIDUAL, TEAM, PK stages)
- Round types: ROUND1_NINE_ONE, ROUND2_RELAY, ROUND3_COLLABORATE, TEAM_STANDARD, INDIVIDUAL_STANDARD
- Configurable round duration and preparation time
- Publish gate: requires judge + participants + stages + rounds with puzzles before publishing
- Access link generation after publish (unique codes, regenerable)

### Judge Management
- Assign existing judges from dropdown
- **Create & Assign Judge**: enter a display name, system auto-generates username + password, creates user (role=JUDGE), assigns to competition in one step. Credentials shown once in a dialog.
- Display mode controls (Live Ranking, Round Ranking, Stage Ranking, Final Ranking, Live Player Grid)
- Broadcast individual player grids to big screen

### Participant Management
- Excel import with auto-generated credentials
- Export credentials as XLSX
- PDF puzzle import per-round (upload, preview, confirm)
- Participant monitoring (live presence, connection status)

### Real-Time Features
- WebSocket-based game state sync (player grids, scores)
- Big-screen display with token-based access (no login required)
- Display mode switching (judge controls what the big screen shows)
- Stage ranking display mode
- Live player grid projection
- Player monitoring panel (judge sees live scores and connection status)

### Security
- WebSocket authentication with token validation
- REST endpoint security (auth middleware, tenant guard, role checks)
- Rate limiting (auth: 200/15min, expensive ops: 30/15min)
- Cross-tenant isolation verified (tenant guard on all competition routes)
- Security headers (CSP, X-Frame-Options, etc.)
- Input validation with Zod schemas

### Performance
- Batch queries in scoring and monitoring endpoints
- Parallelized queries in DisplayManager and monitoring endpoints
- Prisma client regeneration after schema changes

---

## Recent Changes (This Session)

### 1. Create & Assign Judge Feature
- **Backend**: `POST /api/competitions/:id/judges/create-and-assign`
  - Generates unique username from display name (slugified + random suffix)
  - Generates random password (unambiguous charset)
  - Atomically creates user + assigns judge via Prisma transaction
  - Retries up to 3 times on username collision (P2002)
  - Returns plaintext credentials once (never stored)
- **Frontend**: Text input + green "Create & Assign" button alongside existing dropdown
  - Credentials dialog with copy functionality
  - i18n keys for EN and ZH
- **Files**: `server/src/utils/credentials.js` (new), `server/src/validations/competitions.js`, `server/src/routes/competitionSetup.js`, `client/src/api/index.js`, `client/src/pages/CompetitionDetailPage.jsx`, `client/src/i18n/en.js`, `client/src/i18n/zh.js`

### 2. Publish → Access Link Bug Fix
- **Issue**: After publishing, the "Generate Access Link" button remained disabled until manual page reload
- **Root cause**: `PublishPanel` refreshed its own snapshot after publish but never told the parent to re-fetch the competition, so `competition.status` stayed `'DRAFT'` and `canGenerate` stayed `false`
- **Fix**: Added `onStatusChange` callback prop to `PublishPanel`, wired to parent's `load()` function
- **Files**: `client/src/components/PublishPanel.jsx`, `client/src/pages/CompetitionDetailPage.jsx`

### 3. Null Guard Bug Fix
- **Issue**: `TypeError: Cannot read properties of null (reading 'judges')` on page load
- **Root cause**: `unassignedJudges` filter computed before the `if (!competition)` null guard, accessing `competition.judges` while `competition` was still null
- **Fix**: Added optional chaining (`competition?.judges`)
- **Files**: `client/src/pages/CompetitionDetailPage.jsx`

### 4. PDF Import Bug Fix
- **Issue**: PDF import confirm created 0 puzzles silently
- **Root cause**: Prisma Client was stale after migration 051 added `organization_id` and `round_type` columns to puzzles table. `prisma.puzzles.create()` failed with `PrismaClientValidationError: Unknown argument`
- **Fix**: Regenerated Prisma Client (`npx prisma generate`), restarted server
- **Files**: `server/src/services/PdfImportService.js`, `server/src/routes/puzzleBank.js`

### 5. Migration Restructuring
- **Change**: Migrations 048-051 moved from `server/prisma/migrations/` (Prisma format) to `server/migrations/` (node-pg-migrate format)
- **Reason**: Project uses node-pg-migrate for schema migrations, not Prisma migrations
- **Files**: Deleted 5 Prisma `.sql` migrations, added 4 node-pg-migrate `.js` migrations

---

## Known Issues & Limitations

### ISSUE-014: Round Auto-Stop
- **Severity**: HIGH
- **Description**: Rounds do NOT stop automatically when the timer expires. The judge must click "End Round" manually.
- **Status**: Assigned to Sylvain (engine fix)
- **Workaround**: Manual "End Round" button

### ISSUE-018: Production Secrets
- **Severity**: CRITICAL (pre-production)
- **Description**: Production secrets must be rotated and removed from git history before going live
- **Status**: Human action required

### ISSUE-033: GameOrchestrator Team-Stage Tests
- **Severity**: MEDIUM
- **Description**: 11 GameOrchestrator team-stage tests failing
- **Status**: Assigned to Sylvain

### Display Mode: Final Ranking
- **Limitation**: UUIDs may show instead of participant names in final rankings
- **Status**: Known, needs fix in `finalRankings` query

### WebSocket Disconnect Recovery
- **Limitation**: PLAN-R14 (disconnect recovery) not fully verified — expect rough edges
- **Status**: Known, not blocking

### Rate Limiter IPv6 Warning
- **Severity**: LOW (non-blocking)
- **Description**: `express-rate-limit` throws a validation warning about IPv6 key generation at startup
- **Status**: Pre-existing, does not crash the server

---

## Test Coverage

- **Server**: 33 test suites, 524 tests
  - Run: `cd server; npm test`
- **Client**: 36 test suites, 367 tests
  - Run: `cd client; npm test -- --run`
- **Lint**: 0 warnings
  - Run: `cd client; npm run lint`

---

## Pre-Production Checklist

Before opening to real competitors:

- [ ] **ISSUE-014**: Round auto-stop when timer expires (Sylvain)
- [ ] **ISSUE-018**: Production secrets rotated and removed from git history
- [ ] **ISSUE-033**: GameOrchestrator team-stage tests pass (Sylvain)
- [ ] **Manual Testing Guide**: Sections 1-6 all scenarios ticked
- [ ] **Manual Testing Guide**: Section 7 security spot-checks green
- [ ] Server: `NODE_ENV=production`
- [ ] Server: New `JWT_SECRET` (32+ random chars) different from dev
- [ ] Server: `.env.production` generated fresh on target host
- [ ] HTTPS on client side (nginx or Caddy reverse-proxy)
- [ ] Automated database backups (daily at minimum)
- [ ] Uptime + 5xx error monitoring

**Do NOT open to public users until every box is ticked.**

---

## Next Steps

1. **Fix ISSUE-014** (round auto-stop) — blocking for production
2. **Fix ISSUE-033** (GameOrchestrator tests) — blocking for production
3. **Rotate production secrets** (ISSUE-018) — blocking for production
4. **Complete manual testing** per `docs/MANUAL_TESTING_GUIDE.md`
5. **Deploy to staging** for end-to-end validation
6. **Deploy to production** with HTTPS, monitoring, and backups

---

## File Structure

```
project_3/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── api/              # API client
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/            # Route-level pages
│   │   ├── i18n/             # Translations (en.js, zh.js)
│   │   └── hooks/            # Custom React hooks
│   └── dist/                 # Production build output
├── server/                    # Node.js backend (Express)
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   ├── engine/           # Game orchestration
│   │   ├── middleware/       # Auth, validation, rate limiting
│   │   └── db/               # Prisma client, repositories
│   ├── prisma/               # Prisma schema + migrations (001-051)
│   ├── migrations/           # node-pg-migrate migrations (048-051)
│   └── __tests__/            # Jest test suites
└── docs/                      # Project documentation
```

---

## References

- **Manual Testing Guide**: `docs/MANUAL_TESTING_GUIDE.md`
- **Database Backup/Restore**: `server/docs/DATABASE_BACKUP_RESTORE.md`
- **Technical Overview**: `PROJECT_TECHNICAL_OVERVIEW.md`
- **WebSocket Design**: `docs/Part8-WebSocket事件设计.md`
- **REST API Spec**: `docs/Part7-REST-API.md`
