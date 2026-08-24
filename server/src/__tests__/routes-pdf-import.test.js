// Integration tests for the two PDF-import routes on the puzzle-bank
// router (F88). Covers:
//   - Auth / role gate on both routes (POST /puzzle-bank/import-pdf and
//     POST /puzzle-bank/import-pdf/confirm).
//   - Phase 1 accepts a PDF, stashes the parsed questions, returns a
//     preview without solutions.
//   - Phase 2 requires a valid stash, honors the Zod schema on roundType,
//     scopes duplicate check + orderInRound to the caller's org, drops
//     foreign categoryIds, and clears the stash on success.
//   - Cross-tenant safety: an admin from Org A cannot confirm a stash
//     built by Org B, cannot see Org B's puzzles when checking for
//     duplicates, and cannot import a puzzle tagged with Org B's
//     categoryId (it gets stripped).
//
// pdf-parse is mocked (same trick as services-pdf-import.test.js) so the
// test controls the parser output without shipping a real PDF blob.
// PuzzleBankService's file IO is stubbed via _load/_save spies.

// Bypass rate limiters — the suite runs 18 requests from the same IP,
// which trips express-rate-limit's default ceiling and swaps the real
// status codes for 429s. The route's rate-limit protection is tested
// separately (rateLimiters.test.js in the security-audit suite).
jest.mock('../middleware/rateLimiters', () => ({
  authLimiter: (req, res, next) => next(),
  expensiveLimiter: (req, res, next) => next(),
}));

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(function ({ data }) {
    this.getText = jest.fn(async () => ({ text: mockPdfText }));
  }),
}));

let mockPdfText = '';

// getPrisma mock — the /confirm route calls:
//   - prisma.rounds.findUnique (tenant guard + round.round_type lookup)
//   - prisma.categories.findMany (foreign categoryId check)
const mockCategoriesFindMany = jest.fn();
const mockRoundsFindUnique = jest.fn();
jest.mock('../db/prisma', () => ({
  getPrisma: () => ({
    categories: { findMany: mockCategoriesFindMany },
    rounds: { findUnique: mockRoundsFindUnique },
  }),
}));

// PuzzleBankService — stub the disk IO. The bank starts empty and grows
// as the route pushes into it. importToRound is called automatically by
// the confirm route after the bank is written; the tests inspect that
// call to prove the "one batch, one round" guarantee.
const bankState = { meta: {}, puzzles: [] };
const mockImportToRound = jest.fn(async ({ puzzleIds }) => ({ imported: puzzleIds?.length ?? 0 }));
jest.mock('../services/PuzzleBankService', () => {
  return jest.fn().mockImplementation(function () {
    this._load = jest.fn(() => bankState);
    this._save = jest.fn();
    this.listPuzzles = jest.fn(() => ({ total: bankState.puzzles.length, puzzles: bankState.puzzles, meta: {} }));
    this.getPuzzleDetail = jest.fn();
    this.getPuzzlePreview = jest.fn();
    this.generatePuzzles = jest.fn();
    this.generateBulk = jest.fn();
    this.importToRound = mockImportToRound;
    this.deletePuzzle = jest.fn();
    this.clearAll = jest.fn();
  });
});

// Repo — the route now calls repos.puzzles.countByRound to refuse
// overwriting a round that already holds puzzles.
const mockCountByRound = jest.fn(async () => 0);
function buildRepos() {
  return { puzzles: { countByRound: mockCountByRound } };
}

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');
const { createPuzzleBankRouter } = require('../routes/puzzleBank');

const ORG_A = 'org-a-uuid';
const ORG_B = 'org-b-uuid';
const ADMIN_A_TOKEN = generateToken({ id: 'admin-a', username: 'adminA', role: 'ORG_ADMIN', organization_id: ORG_A });
const ADMIN_B_TOKEN = generateToken({ id: 'admin-b', username: 'adminB', role: 'ORG_ADMIN', organization_id: ORG_B });
const JUDGE_TOKEN = generateToken({ id: 'judge-1', username: 'judge', role: 'JUDGE', organization_id: ORG_A });
const PLAYER_TOKEN = generateToken({ id: 'player-1', username: 'player', role: 'PLAYER', organization_id: ORG_A });

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

function pageForQuestion({ id, type = 'INDIVIDUAL', difficulty = 'MEDIUM', score = 10, categoryId }) {
  const initial = Array(9).fill('012345678').join('\n');
  const solution = Array(9).fill('123456789').join('\n');
  const lines = [
    `QUESTION ${id}`,
    `ID ${id}`,
    `TYPE ${type}`,
    `DIFFICULTY ${difficulty}`,
    `SCORE ${score}`,
  ];
  if (categoryId) lines.push(`CATEGORY_ID ${categoryId}`);
  lines.push('INITIAL_GRID', initial, 'SOLUTION_GRID', solution);
  return lines.join('\n');
}

function pdfWithPages(pages) {
  return pages.join('\f');
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createPuzzleBankRouter(buildRepos()));
  return app;
}

// Convenient defaults for a "healthy" round owned by ORG_A. Individual
// tests override to test tenant guards / not-found / already-populated.
const ROUND_A_ID = '99999999-9999-4999-8999-999999999999';
const ROUND_B_ID = '88888888-8888-4888-8888-888888888888';

function mockRoundOwnedBy(orgId, { roundId = ROUND_A_ID, roundType = 'INDIVIDUAL_STANDARD' } = {}) {
  mockRoundsFindUnique.mockImplementation(async ({ where }) => {
    if (where.id !== roundId) return null;
    return {
      id: roundId,
      round_type: roundType,
      competition_stages: {
        competitions: { organization_id: orgId },
      },
    };
  });
}

// Minimal valid PDF magic bytes so validateFileType lets the request
// through. The mocked PDFParse doesn't actually read the buffer.
const FAKE_PDF_BUFFER = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.alloc(100, 0x20), // padding so buffer is > 8 bytes
]);

beforeEach(() => {
  jest.clearAllMocks();
  bankState.puzzles = [];
  mockPdfText = '';
  mockCategoriesFindMany.mockResolvedValue([]);
  mockCountByRound.mockResolvedValue(0);
  mockImportToRound.mockImplementation(async ({ puzzleIds }) => ({ imported: puzzleIds?.length ?? 0 }));
});

describe('POST /api/puzzle-bank/import-pdf (phase 1)', () => {
  test('rejects requests without a token (401)', async () => {
    const res = await request(buildApp()).post('/api/puzzle-bank/import-pdf');
    expect(res.status).toBe(401);
  });

  test('rejects PLAYER (403)', async () => {
    mockPdfText = pdfWithPages([pageForQuestion({ id: '001' })]);
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .attach('file', FAKE_PDF_BUFFER, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  test('rejects JUDGE (403) — puzzle bank is admin-only', async () => {
    mockPdfText = pdfWithPages([pageForQuestion({ id: '001' })]);
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .attach('file', FAKE_PDF_BUFFER, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  test('accepts ORG_ADMIN, returns a preview WITHOUT solutions', async () => {
    mockPdfText = pdfWithPages([pageForQuestion({ id: '001' })]);
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .attach('file', FAKE_PDF_BUFFER, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.body.code).toBe(200);
    expect(res.body.data.parsed).toBe(1);
    expect(res.body.data.questions).toHaveLength(1);
    // The preview MUST NOT expose the solution grid.
    expect(res.body.data.questions[0].solutionGrid).toBeUndefined();
    expect(res.body.data.questions[0].emptyCellCount).toBeGreaterThan(0);
  });

  test('rejects a file whose magic bytes are not PDF', async () => {
    const notAPdf = Buffer.from('this is a text file, not a pdf');
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .attach('file', notAPdf, { filename: 'fake.pdf', contentType: 'application/pdf' });
    // validateFileType returns 200 with a 40001 code envelope, not a
    // 4xx HTTP status.
    expect(res.body.code).toBe(40001);
  });
});

describe('POST /api/puzzle-bank/import-pdf/confirm (phase 2)', () => {
  // Every phase-2 test needs a stash (built by upload) AND a round
  // fixture (returned by the prisma mock). The confirm route rejects
  // both "no stash" and "roundId not found or foreign".
  async function upload(app, token, questionSpecs) {
    mockPdfText = pdfWithPages(questionSpecs.map(pageForQuestion));
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FAKE_PDF_BUFFER, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.body.code).toBe(200);
  }

  test('rejects if no stash exists for the user (40020)', async () => {
    mockRoundOwnedBy(ORG_A);
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(40020);
  });

  test('rejects a body that is missing roundId (Zod, BUG-PDF-06)', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({}); // no roundId
    expect(res.body.code).toBe(40001);
  });

  test('rejects a roundId that is not a UUID (Zod)', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: 'not-a-uuid' });
    expect(res.body.code).toBe(40001);
  });

  test('rejects a roundId that does not exist (404)', async () => {
    mockRoundsFindUnique.mockResolvedValue(null);
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(40400);
  });

  test('TENANT: rejects a roundId that belongs to another org (403)', async () => {
    // The round exists but its competition is owned by Org B.
    mockRoundOwnedBy(ORG_B, { roundId: ROUND_B_ID });
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_B_ID });
    expect(res.body.code).toBe(40301);
    // Nothing was written to the bank.
    expect(bankState.puzzles).toHaveLength(0);
  });

  test('refuses to overwrite a round that already holds puzzles (40030)', async () => {
    mockRoundOwnedBy(ORG_A);
    mockCountByRound.mockResolvedValue(5); // round already populated
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(40030);
    expect(res.body.data.existing).toBe(5);
    // Nothing written to the bank, nothing imported to the round.
    expect(bankState.puzzles).toHaveLength(0);
    expect(mockImportToRound).not.toHaveBeenCalled();
  });

  test('writes into the bank AND auto-imports into the round in one action', async () => {
    mockRoundOwnedBy(ORG_A, { roundType: 'INDIVIDUAL_STANDARD' });
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }, { id: '002' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.data.importedToRound).toBe(2);
    // Every bank entry is stamped with Org A, the round's type, and a
    // server-generated id — no PDF value ever becomes a bank key.
    for (const p of bankState.puzzles) {
      expect(p.organizationId).toBe(ORG_A);
      expect(p.roundType).toBe('INDIVIDUAL_STANDARD');
      expect(p.id).toMatch(/^PDF-[0-9a-f-]{36}$/);
      expect(p.source).toBe('PDF_IMPORT');
    }
    // importToRound was called with the caller's roundId and the ids
    // that were just written — the "one batch, one round" guarantee.
    expect(mockImportToRound).toHaveBeenCalledTimes(1);
    const call = mockImportToRound.mock.calls[0][0];
    expect(call.roundId).toBe(ROUND_A_ID);
    expect(call.puzzleIds).toHaveLength(2);
  });

  test('CROSS-TENANT: Org B cannot confirm using Org A stash', async () => {
    mockRoundOwnedBy(ORG_B, { roundId: ROUND_B_ID });
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    // Org B sends its own valid roundId — but has no stash of its own.
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_B_TOKEN}`)
      .send({ roundId: ROUND_B_ID });
    expect(res.body.code).toBe(40020);
  });

  test('CROSS-TENANT: bank duplicate check is org-scoped (PDF-01)', async () => {
    mockRoundOwnedBy(ORG_B, { roundId: ROUND_B_ID });
    // Seed the bank with existing Org A entries; Org B's import must
    // still count from 1 and land the full batch.
    bankState.puzzles.push({ id: 'PDF-existing-org-a-1', organizationId: ORG_A, roundType: 'INDIVIDUAL_STANDARD' });
    bankState.puzzles.push({ id: 'PDF-existing-org-a-2', organizationId: ORG_A, roundType: 'INDIVIDUAL_STANDARD' });
    const app = buildApp();
    await upload(app, ADMIN_B_TOKEN, [{ id: '101' }, { id: '102' }, { id: '103' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_B_TOKEN}`)
      .send({ roundId: ROUND_B_ID });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(3);
    const orgBEntries = bankState.puzzles.filter(p => p.organizationId === ORG_B);
    const orgAEntries = bankState.puzzles.filter(p => p.organizationId === ORG_A);
    expect(orgBEntries).toHaveLength(3);
    expect(orgAEntries).toHaveLength(2);
    expect(orgBEntries.map(p => p.orderInRound).sort()).toEqual([1, 2, 3]);
  });

  test('PDF-03: strips foreign categoryId (belongs to another org)', async () => {
    mockRoundOwnedBy(ORG_A);
    mockCategoriesFindMany.mockResolvedValue([]); // Org A owns none of them
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001', categoryId: VALID_UUID_B }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.strippedCategoryIds).toBe(1);
    expect(bankState.puzzles[0].categoryId).toBeNull();
  });

  test('PDF-03: keeps categoryId that belongs to the caller org', async () => {
    mockRoundOwnedBy(ORG_A);
    mockCategoriesFindMany.mockResolvedValue([{ id: VALID_UUID_A }]);
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001', categoryId: VALID_UUID_A }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(200);
    expect(res.body.data.strippedCategoryIds).toBe(0);
    expect(bankState.puzzles[0].categoryId).toBe(VALID_UUID_A);
  });

  test('clears the stash after a successful confirm (no double-confirm)', async () => {
    mockRoundOwnedBy(ORG_A);
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const first = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(first.body.code).toBe(200);

    const second = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(second.body.code).toBe(40020);
  });

  test('partial-success envelope when the bank write succeeds but importToRound throws', async () => {
    mockRoundOwnedBy(ORG_A);
    mockImportToRound.mockRejectedValueOnce(new Error('database timeout'));
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundId: ROUND_A_ID });
    expect(res.body.code).toBe(50001);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.importedToRound).toBe(0);
    // Puzzles are in the bank — the admin can retry the round-import
    // manually via "Import from bank".
    expect(bankState.puzzles).toHaveLength(1);
  });
});
