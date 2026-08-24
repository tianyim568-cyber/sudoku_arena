// Unit tests for PdfImportService (F88 — PDF puzzle import).
//
// The service does two things:
//   1. parsePdf(buffer): turn a raw PDF into a list of question objects.
//   2. toPuzzleBankEntry(question, roundType, orgId): shape a parsed
//      question into a puzzle-bank-compatible entry, with the id
//      regenerated server-side and the org tag stamped on.
//
// We mock pdf-parse so no real PDF file is needed: the test controls
// the text the parser sees. This keeps the test deterministic and fast,
// and it lets us cover the parser edge cases (missing keys, bad grids,
// invalid CATEGORY_ID, oversized batches) without hand-crafting PDFs.

jest.mock('pdf-parse', () => {
  return {
    PDFParse: jest.fn().mockImplementation(function ({ data }) {
      this.__data = data;
      this.getText = jest.fn(async () => {
        const text = mockPdfText;
        return { text };
      });
    }),
  };
});

let mockPdfText = '';
const PdfImportService = require('../services/PdfImportService');

function pageForQuestion({ id, type = 'INDIVIDUAL', difficulty = 'MEDIUM', score = 10, categoryId, initial, solution }) {
  const initialGrid = initial || Array(9).fill('012345678');
  const solutionGrid = solution || Array(9).fill('123456789');
  return [
    `QUESTION ${id}`,
    'Copy this page format exactly for every question in an import PDF.',
    `ID ${id}`,
    `TYPE ${type}`,
    `DIFFICULTY ${difficulty}`,
    `SCORE ${score}`,
    categoryId ? `CATEGORY_ID ${categoryId}` : null,
    'INITIAL_GRID',
    ...initialGrid,
    'SOLUTION_GRID',
    ...solutionGrid,
  ].filter(Boolean).join('\n');
}

// pdf-parse merges pages with a form-feed. Reproduce that here.
function pdfWithPages(pages) {
  return pages.join('\f');
}

const VALID_UUID = '3f2a9c14-1234-4abc-9def-000000000001';

describe('PdfImportService.parsePdf', () => {
  let service;
  beforeEach(() => {
    service = new PdfImportService();
    mockPdfText = '';
  });

  test('returns an empty result with an error when the PDF text is blank', async () => {
    mockPdfText = '';
    const { questions, errors } = await service.parsePdf(Buffer.from(''));
    expect(questions).toEqual([]);
    expect(errors).toContain('PDF 文件中未提取到文本内容');
  });

  test('returns an error when no QUESTION marker is present', async () => {
    mockPdfText = 'Cover page\nCopyright 2026';
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toEqual([]);
    expect(errors[0]).toMatch(/未在 PDF 中找到任何题目/);
  });

  test('parses a well-formed page into one question', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001', type: 'INDIVIDUAL', difficulty: 'EASY', score: 5, categoryId: VALID_UUID }),
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.sourceId).toBe('001');
    expect(q.type).toBe('INDIVIDUAL');
    expect(q.difficulty).toBe('EASY');
    expect(q.score).toBe(5);
    expect(q.categoryId).toBe(VALID_UUID);
    expect(q.initialGrid).toHaveLength(9);
    expect(q.solutionGrid).toHaveLength(9);
  });

  test('rejects CATEGORY_ID that is not a UUID (injection guard)', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001', categoryId: '../../etc/passwd' }),
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toEqual([]);
    expect(errors[0]).toMatch(/CATEGORY_ID 格式无效/);
  });

  test('rejects invalid TYPE / DIFFICULTY / SCORE', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001', type: 'PK' }),
      pageForQuestion({ id: '002', difficulty: 'IMPOSSIBLE' }),
      pageForQuestion({ id: '003', score: -1 }),
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toEqual([]);
    expect(errors.some(e => /TYPE 无效/.test(e))).toBe(true);
    expect(errors.some(e => /DIFFICULTY 无效/.test(e))).toBe(true);
    expect(errors.some(e => /SCORE 无效/.test(e))).toBe(true);
  });

  test('rejects incomplete grids (< 9 rows)', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001', initial: ['000000000'] /* only 1 row */ }),
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toEqual([]);
    expect(errors[0]).toMatch(/INITIAL_GRID 不完整/);
  });

  test('caps the batch at MAX_QUESTIONS_PER_PDF (500) with a warning', async () => {
    const pages = Array.from({ length: 550 }, (_, i) => pageForQuestion({ id: String(i + 1) }));
    mockPdfText = pdfWithPages(pages);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toHaveLength(500);
    expect(errors.some(e => /已达上限 500/.test(e))).toBe(true);
  });

  test('reports per-page errors without aborting the whole batch', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001' }),                        // good
      pageForQuestion({ id: '002', type: 'PK' }),            // bad TYPE
      pageForQuestion({ id: '003' }),                        // good
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  test('rejects SCORE larger than the sanity cap', async () => {
    mockPdfText = pdfWithPages([
      pageForQuestion({ id: '001', score: 999999 }),
    ]);
    const { questions, errors } = await service.parsePdf(Buffer.from('x'));
    expect(questions).toEqual([]);
    expect(errors[0]).toMatch(/SCORE 过大/);
  });
});

describe('PdfImportService.toPuzzleBankEntry', () => {
  const service = new PdfImportService();
  const sampleQuestion = {
    sourceId: 'PDF-42',
    type: 'INDIVIDUAL',
    difficulty: 'MEDIUM',
    score: 10,
    categoryId: VALID_UUID,
    initialGrid: Array(9).fill(Array(9).fill(0)),
    solutionGrid: Array(9).fill(Array(9).fill(1)),
  };

  test('regenerates the id server-side — the PDF sourceId is never the key (BUG-PDF-02)', () => {
    const entry1 = service.toPuzzleBankEntry(sampleQuestion, 'INDIVIDUAL_STANDARD', 'org-A');
    const entry2 = service.toPuzzleBankEntry(sampleQuestion, 'INDIVIDUAL_STANDARD', 'org-A');
    // Two entries built from the same question have DIFFERENT ids —
    // the id comes from crypto.randomUUID(), not from the PDF.
    expect(entry1.id).not.toBe(entry2.id);
    expect(entry1.id).toMatch(/^PDF-[0-9a-f-]{36}$/);
    // sourceId is preserved for audit but is NOT the bank key.
    expect(entry1.sourceId).toBe('PDF-42');
  });

  test('stamps organizationId from the caller — never from the question', () => {
    const entry = service.toPuzzleBankEntry(sampleQuestion, 'IMPORTED', 'org-caller');
    expect(entry.organizationId).toBe('org-caller');
    // Even if a rogue question had a foreign organizationId injected, the
    // service ignores it.
    const rogue = { ...sampleQuestion, organizationId: 'org-someone-else' };
    const entry2 = service.toPuzzleBankEntry(rogue, 'IMPORTED', 'org-caller');
    expect(entry2.organizationId).toBe('org-caller');
  });

  test('tags the entry with source: PDF_IMPORT for audit trail', () => {
    const entry = service.toPuzzleBankEntry(sampleQuestion, 'IMPORTED', 'org-A');
    expect(entry.source).toBe('PDF_IMPORT');
  });

  test('maps INDIVIDUAL to JOC puzzle type, TEAM to STANDARD', () => {
    const indivEntry = service.toPuzzleBankEntry({ ...sampleQuestion, type: 'INDIVIDUAL' }, 'IMPORTED', 'org-A');
    const teamEntry = service.toPuzzleBankEntry({ ...sampleQuestion, type: 'TEAM' }, 'IMPORTED', 'org-A');
    expect(indivEntry.puzzleType).toBe('JOC');
    expect(teamEntry.puzzleType).toBe('STANDARD');
  });

  test('defaults roundType to IMPORTED when none is given', () => {
    const entry = service.toPuzzleBankEntry(sampleQuestion, null, 'org-A');
    expect(entry.roundType).toBe('IMPORTED');
  });
});
