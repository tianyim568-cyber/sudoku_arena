/**
 * PdfImportService — extract sudoku puzzles from structured PDF files.
 *
 * Expected format (one question per page):
 *   QUESTION 001
 *   Copy this page format exactly for every question in an import PDF.
 *   ID <uuid>
 *   TYPE INDIVIDUAL|TEAM
 *   DIFFICULTY EASY|MEDIUM|HARD
 *   SCORE <integer>
 *   CATEGORY_ID <uuid>
 *   INITIAL_GRID
 *   <9 lines of 9 digits, 0 = empty cell>
 *   SOLUTION_GRID
 *   <9 lines of 9 digits>
 *
 * Uses pdf-parse for text extraction. No OCR required — the PDFs are
 * machine-generated with embedded text.
 */

const pdfParse = require('pdf-parse');
const logger = require('../utils/logger');

class PdfImportService {
  /**
   * Parse a PDF buffer and extract question blocks.
   *
   * @param {Buffer} pdfBuffer — raw PDF file content
   * @returns {{ questions: Array, errors: Array<string> }}
   */
  async parsePdf(pdfBuffer) {
    let pdfData;
    try {
      pdfData = await pdfParse(pdfBuffer);
    } catch (err) {
      logger.error('PDF parse failed', { error: err.message });
      return { questions: [], errors: ['无法解析 PDF 文件，请确认文件格式正确'] };
    }

    const fullText = pdfData.text || '';
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
    let initialGrid = null;
    let solutionGrid = null;
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

    // Validate required fields
    if (!meta.ID) throw new Error('缺少 ID 字段');
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

    // Validate grids
    if (gridLines.initial.length !== 9) {
      throw new Error(`INITIAL_GRID 不完整: 需要 9 行，仅找到 ${gridLines.initial.length} 行`);
    }
    if (gridLines.solution.length !== 9) {
      throw new Error(`SOLUTION_GRID 不完整: 需要 9 行，仅找到 ${gridLines.solution.length} 行`);
    }

    // Convert grid strings to 2D number arrays
    initialGrid = gridLines.initial.map(row =>
      row.split('').map(ch => parseInt(ch, 10))
    );
    solutionGrid = gridLines.solution.map(row =>
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
      id: meta.ID,
      type: meta.TYPE,
      difficulty: meta.DIFFICULTY,
      score,
      categoryId: meta.CATEGORY_ID || null,
      initialGrid,
      solutionGrid,
    };
  }

  /**
   * Map a parsed PDF question to the puzzle-bank.json format used by
   * PuzzleBankService. The round type is not in the PDF — it must be
   * chosen by the admin at import time (or left as a generic pool).
   *
   * @param {object} question — parsed question from parsePdf()
   * @param {string} roundType — target round type (e.g. 'ROUND1_NINE_ONE')
   * @param {string} organizationId — owning org
   * @returns {object} puzzle-bank-compatible entry
   */
  toPuzzleBankEntry(question, roundType, organizationId) {
    return {
      id: question.id,
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
    };
  }
}

module.exports = PdfImportService;
