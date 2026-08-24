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

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(function ({ data }) {
    this.getText = jest.fn(async () => ({ text: mockPdfText }));
  }),
}));

let mockPdfText = '';

// getPrisma mock — the /confirm route calls prisma.categories.findMany
// to validate that CATEGORY_IDs belong to the caller's org.
const mockCategoriesFindMany = jest.fn();
jest.mock('../db/prisma', () => ({
  getPrisma: () => ({
    categories: { findMany: mockCategoriesFindMany },
  }),
}));

// PuzzleBankService — stub the disk IO. The bank starts empty and grows
// as the route pushes into it.
const bankState = { meta: {}, puzzles: [] };
jest.mock('../services/PuzzleBankService', () => {
  return jest.fn().mockImplementation(function () {
    this._load = jest.fn(() => bankState);
    this._save = jest.fn();
    this.listPuzzles = jest.fn(() => ({ total: bankState.puzzles.length, puzzles: bankState.puzzles, meta: {} }));
    this.getPuzzleDetail = jest.fn();
    this.getPuzzlePreview = jest.fn();
    this.generatePuzzles = jest.fn();
    this.generateBulk = jest.fn();
    this.importToRound = jest.fn();
    this.deletePuzzle = jest.fn();
    this.clearAll = jest.fn();
  });
});

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
  app.use('/api', createPuzzleBankRouter({}));
  return app;
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
  async function upload(app, token, questionSpecs) {
    mockPdfText = pdfWithPages(questionSpecs.map(pageForQuestion));
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FAKE_PDF_BUFFER, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.body.code).toBe(200);
  }

  test('rejects if no stash exists for the user (40020)', async () => {
    const res = await request(buildApp())
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD' });
    expect(res.body.code).toBe(40020);
  });

  test('rejects an invalid roundType via Zod (BUG-PDF-06)', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'ROUND9000_INJECTION' });
    // validateBody returns HTTP 200 with a { code: 40001 } envelope
    // (that's the app-wide convention — HTTP 200 for expected errors,
    // 4xx only for auth / transport failures).
    expect(res.body.code).toBe(40001);
  });

  test('accepts a valid roundType and writes into the bank scoped to Org A', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }, { id: '002' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD' });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(2);
    // Every bank entry is stamped with Org A and a server-generated id.
    for (const p of bankState.puzzles) {
      expect(p.organizationId).toBe(ORG_A);
      expect(p.id).toMatch(/^PDF-[0-9a-f-]{36}$/);
      expect(p.source).toBe('PDF_IMPORT');
    }
  });

  test('CROSS-TENANT: Org B cannot confirm using Org A stash', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_B_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD' });
    // No stash for Org B → 40020, not accidental access to Org A's stash.
    expect(res.body.code).toBe(40020);
  });

  test('CROSS-TENANT: duplicate check does not leak Org A puzzles when Org B imports (BUG-PDF-01)', async () => {
    // Contrived scenario: seed the bank with an Org A puzzle whose id
    // starts with "PDF-" (matches what the server generates). Since the
    // duplicate check MUST filter by organizationId too, an Org B import
    // whose freshly-generated id happens to already exist for Org A
    // would still land — and, more importantly, an Org B import that
    // reuses an Org A id would NOT reveal that fact to the caller via
    // a silent skip.
    //
    // We can't force an id collision (UUIDs are random) so we test the
    // easier invariant: with an existing Org A puzzle in the bank, an
    // Org B import of N questions still inserts N puzzles. The filter
    // must scope by organizationId or the count would drift.
    bankState.puzzles.push({ id: 'PDF-existing-org-a-1', organizationId: ORG_A, roundType: 'IMPORTED' });
    bankState.puzzles.push({ id: 'PDF-existing-org-a-2', organizationId: ORG_A, roundType: 'IMPORTED' });
    const app = buildApp();
    await upload(app, ADMIN_B_TOKEN, [{ id: '101' }, { id: '102' }, { id: '103' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_B_TOKEN}`)
      .send({ roundType: 'IMPORTED' });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(3);
    // Org B has exactly the 3 it imported; Org A still has its 2 seeded.
    const orgBEntries = bankState.puzzles.filter(p => p.organizationId === ORG_B);
    const orgAEntries = bankState.puzzles.filter(p => p.organizationId === ORG_A);
    expect(orgBEntries).toHaveLength(3);
    expect(orgAEntries).toHaveLength(2);
    // orderInRound is scoped to the caller org — Org B starts at 1 even
    // though the bank already holds Org A entries for the same roundType.
    const orgBOrders = orgBEntries.map(p => p.orderInRound).sort();
    expect(orgBOrders).toEqual([1, 2, 3]);
  });

  test('BUG-PDF-03: strips foreign categoryId (belongs to another org)', async () => {
    // Admin A uploads a PDF referencing a categoryId — but the categories
    // table says that id belongs to Org B (not returned by findMany).
    mockCategoriesFindMany.mockResolvedValue([]); // nothing owned by Org A
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001', categoryId: VALID_UUID_B }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD' });
    expect(res.body.code).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.strippedCategoryIds).toBe(1);
    expect(bankState.puzzles[0].categoryId).toBeNull();
  });

  test('BUG-PDF-03: keeps categoryId that belongs to the caller org', async () => {
    mockCategoriesFindMany.mockResolvedValue([{ id: VALID_UUID_A }]);
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001', categoryId: VALID_UUID_A }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD' });
    expect(res.body.code).toBe(200);
    expect(res.body.data.strippedCategoryIds).toBe(0);
    expect(bankState.puzzles[0].categoryId).toBe(VALID_UUID_A);
  });

  test('clears the stash after a successful confirm (no double-confirm)', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const first = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'IMPORTED' });
    expect(first.body.code).toBe(200);

    const second = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: 'IMPORTED' });
    expect(second.body.code).toBe(40020);
  });

  test('accepts a null roundType (generic pool)', async () => {
    const app = buildApp();
    await upload(app, ADMIN_A_TOKEN, [{ id: '001' }]);
    const res = await request(app)
      .post('/api/puzzle-bank/import-pdf/confirm')
      .set('Authorization', `Bearer ${ADMIN_A_TOKEN}`)
      .send({ roundType: null });
    expect(res.body.code).toBe(200);
    expect(bankState.puzzles[0].roundType).toBe('IMPORTED');
  });
});
