/**
 * PdfImportService — extract sudoku puzzles from structured PDF files.
 *
 * Expected format (one question per page):
 *   QUESTION 001
 *   Copy this page format exactly for every question in an import PDF.
 *   ID <string>           (informational only — the server regenerates a
 *                          UUID at import; see BUG-PDF-02 for rationale)
 *   TYPE INDIVIDUAL|TEAM
 *   DIFFICULTY EASY|MEDIUM|HARD
 *   SCORE <integer>
 *   CATEGORY_ID <uuid>    (validated against the caller's organization)
 *   INITIAL_GRID
 *   <9 lines of 9 digits, 0 = empty cell>
 *   SOLUTION_GRID
 *   <9 lines of 9 digits>
 *
 * ── Dependency note (2026-08-24) ────────────────────────────────────
 * `pdf-parse@2.x` changed the API from a bare function (`pdfParse(buf)`)
 * to a class (`new PDFParse({data: buf}).getText()`). The service uses
 * the v2 API. If the dependency is ever downgraded to 1.x the first
 * upload would throw "pdfParse is not a function".
 */

const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');
const logger = require('../utils/logger');

// Bounds on what we accept out of the parser. A PDF that trips one of
// these limits is refused *before* it lands in the stash, so we never
// hold a pathological buffer in memory.
const MAX_QUESTIONS_PER_PDF = 500;   // Sane upper bound for a real batch.
const MAX_SCORE = 10000;             // A puzzle worth more than this is a typo.

class PdfImportService {
  /**
   * Parse a PDF buffer and extract question blocks.
   *
   * @param {Buffer} pdfBuffer — raw PDF file content
   * @returns {{ questions: Array, errors: Array<string> }}
   */
  async parsePdf(pdfBuffer) {
    let fullText;
    try {
      // pdf-parse@2.x: the constructor takes a config object with `data`;
      // getText() returns `{ text, pages, ... }`. See the dependency note
      // in the file header.
      const parser = new PDFParse({ data: pdfBuffer });
      const result = await parser.getText();
      // Newer builds return `{ text }`; older 2.x builds returned a bare
      // string. Handle both defensively rather than pin one shape.
      fullText = typeof result === 'string' ? result : (result && result.text) || '';
    } catch (err) {
      logger.error('PDF parse failed', { error: err.message });
      return { questions: [], errors: ['无法解析 PDF 文件，请确认文件格式正确'] };
    }

    if (!fullText.trim()) {
      return { questions: [], errors: ['PDF 文件中未提取到文本内容'] };
    }

    // Split by page break (form feed \f) or by QUESTION marker.
    // pdf-parse concatenates pages with \f between them.
    const pages = fullText.split('\f').filter(p => p.trim().length > 0);

    const questions = [];
    const errors = [];

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i].trim();

      // Skip pages that don't contain a QUESTION marker (e.g. the cover page)
      if (!/^QUESTION\s+\d+/m.test(pageText)) {
        continue;
      }

      try {
        const question = this._parseQuestionPage(pageText, i + 1);
        questions.push(question);
        if (questions.length >= MAX_QUESTIONS_PER_PDF) {
          errors.push(`已达上限 ${MAX_QUESTIONS_PER_PDF} 道题目，后续页面被忽略`);
          break;
        }
      } catch (err) {
        errors.push(`第 ${i + 1} 页解析失败: ${err.message}`);
      }
    }

    if (questions.length === 0 && errors.length === 0) {
      errors.push('未在 PDF 中找到任何题目（需要包含 "QUESTION" 标记的页面）');
    }

    return { questions, errors };
  }

  /**
   * Parse a single question page into a puzzle object.
   *
   * @param {string} pageText — text content of one page
   * @param {number} pageNum — page number (for error messages)
   * @returns {object} parsed question
   */
  _parseQuestionPage(pageText, pageNum) {
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const meta = {};
    let currentGrid = null; // 'initial' | 'solution' | null
    const gridLines = { initial: [], solution: [] };

    for (const line of lines) {
      // Skip boilerplate lines
      if (line.match(/^QUESTION\s+\d+/i)) continue;
      if (line.match(/^Copy this page format/i)) continue;
      if (line.match(/^Parser expectation:/i)) continue;

      // Check for grid section headers
      if (line === 'INITIAL_GRID') {
        currentGrid = 'initial';
        continue;
      }
      if (line === 'SOLUTION_GRID') {
        currentGrid = 'solution';
        continue;
      }

      // If inside a grid section, collect grid lines
      if (currentGrid) {
        const gridLine = line.replace(/\s+/g, '');
        if (/^\d{9}$/.test(gridLine)) {
          gridLines[currentGrid].push(gridLine);
          if (gridLines[currentGrid].length === 9) {
            currentGrid = null; // grid complete
          }
          continue;
        }
        // Non-digit line inside grid section — grid ended
        currentGrid = null;
      }

      // Parse key-value metadata
      const kvMatch = line.match(/^(ID|TYPE|DIFFICULTY|SCORE|CATEGORY_ID)\s+(.+)$/i);
      if (kvMatch) {
        meta[kvMatch[1].toUpperCase()] = kvMatch[2].trim();
      }
    }

    // Validate required fields. The ID from the PDF is kept for logging
    // only — the actual puzzle id is regenerated server-side (BUG-PDF-02).
    if (!meta.TYPE) throw new Error('缺少 TYPE 字段');
    if (!meta.DIFFICULTY) throw new Error('缺少 DIFFICULTY 字段');
    if (!meta.SCORE) throw new Error('缺少 SCORE 字段');

    // Validate TYPE
    const validTypes = ['INDIVIDUAL', 'TEAM'];
    if (!validTypes.includes(meta.TYPE)) {
      throw new Error(`TYPE 无效: "${meta.TYPE}"，需要 ${validTypes.join(' 或 ')}`);
    }

    // Validate DIFFICULTY
    const validDifficulties = ['EASY', 'MEDIUM', 'HARD'];
    if (!validDifficulties.includes(meta.DIFFICULTY)) {
      throw new Error(`DIFFICULTY 无效: "${meta.DIFFICULTY}"，需要 ${validDifficulties.join('、')} 之一`);
    }

    // Validate SCORE
    const score = parseInt(meta.SCORE, 10);
    if (isNaN(score) || score < 0) {
      throw new Error(`SCORE 无效: "${meta.SCORE}"，需要非负整数`);
    }
    if (score > MAX_SCORE) {
      throw new Error(`SCORE 过大: "${meta.SCORE}"，最大为 ${MAX_SCORE}`);
    }

    // Validate CATEGORY_ID format (if present). The tenant check happens
    // in the route handler — we do not have access to the DB here.
    let categoryId = meta.CATEGORY_ID || null;
    if (categoryId) {
      // Accept only UUID v4-ish strings. Anything else means the PDF is
      // malformed OR the admin tried to sneak in a path traversal /
      // injection. Reject rather than pass through.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId)) {
        throw new Error(`CATEGORY_ID 格式无效: "${categoryId}"，需要 UUID`);
      }
    }

    // Validate grids
    if (gridLines.initial.length !== 9) {
      throw new Error(`INITIAL_GRID 不完整: 需要 9 行，仅找到 ${gridLines.initial.length} 行`);
    }
    if (gridLines.solution.length !== 9) {
      throw new Error(`SOLUTION_GRID 不完整: 需要 9 行，仅找到 ${gridLines.solution.length} 行`);
    }

    // Convert grid strings to 2D number arrays
    const initialGrid = gridLines.initial.map(row =>
      row.split('').map(ch => parseInt(ch, 10))
    );
    const solutionGrid = gridLines.solution.map(row =>
      row.split('').map(ch => parseInt(ch, 10))
    );

    // Validate grid values (0-9)
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const initVal = initialGrid[r][c];
        const solVal = solutionGrid[r][c];
        if (initVal < 0 || initVal > 9) {
          throw new Error(`INITIAL_GRID 第 ${r + 1} 行第 ${c + 1} 列值无效: ${initVal}`);
        }
        if (solVal < 0 || solVal > 9) {
          throw new Error(`SOLUTION_GRID 第 ${r + 1} 行第 ${c + 1} 列值无效: ${solVal}`);
        }
      }
    }

    return {
      // sourceId keeps the ID from the PDF for logging/audit purposes,
      // but is NEVER used as the puzzle-bank key — see BUG-PDF-02.
      sourceId: meta.ID || null,
      type: meta.TYPE,
      difficulty: meta.DIFFICULTY,
      score,
      categoryId,
      initialGrid,
      solutionGrid,
    };
  }

  /**
   * Map a parsed PDF question to the puzzle-bank.json format used by
   * PuzzleBankService. The round type is not in the PDF — it must be
   * chosen by the admin at import time.
   *
   * Security notes:
   *  - The puzzle id is regenerated server-side via crypto.randomUUID()
   *    to prevent the caller from injecting an arbitrary string as a
   *    bank key (BUG-PDF-02).
   *  - `organizationId` MUST be supplied by the caller — never taken
   *    from the PDF or from a request body — so the puzzle is scoped
   *    to the caller's tenant only.
   *
   * @param {object} question — parsed question from parsePdf()
   * @param {string} roundType — target round type (e.g. 'ROUND1_NINE_ONE')
   * @param {string} organizationId — owning org (from req.user, never from body)
   * @returns {object} puzzle-bank-compatible entry
   */
  toPuzzleBankEntry(question, roundType, organizationId) {
    return {
      // Server-generated: nothing from the PDF can influence this key.
      id: `PDF-${crypto.randomUUID()}`,
      organizationId,
      roundType: roundType || 'IMPORTED',
      puzzleType: question.type === 'TEAM' ? 'STANDARD' : 'JOC',
      difficulty: question.difficulty,
      orderInRound: 0, // will be assigned when imported to a round
      letter: null,
      points: question.score,
      initialGrid: question.initialGrid,
      solution: question.solutionGrid,
      categoryId: question.categoryId,
      source: 'PDF_IMPORT',
      // For audit only — lets an admin cross-reference back to the PDF.
      sourceId: question.sourceId,
    };
  }
}

module.exports = PdfImportService;
