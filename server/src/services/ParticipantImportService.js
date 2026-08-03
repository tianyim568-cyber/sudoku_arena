/**
 * Participant Import Service — Excel parsing, validation, and data preparation.
 * Pure service layer with no Express dependency.
 */

const XLSX = require('xlsx');

// Expected column headers (Chinese). We also accept English aliases.
const HEADER_MAP = {
  '省份': 'province', '省': 'province', 'Province': 'province',
  '城市': 'city', '市': 'city', 'City': 'city',
  '区县': 'district', '区': 'district', 'District': 'district',
  '学校': 'school', '学校名称': 'school', 'School': 'school',
  '姓名': 'name', '学生姓名': 'name', '选手姓名': 'name', 'Name': 'name', 'Student': 'name',
  '年龄': 'age', 'Age': 'age',
  '组别': 'category', '分组': 'category', 'Category': 'category', 'Group': 'category',
  '队伍名称': 'teamName', '队伍': 'teamName', '队名': 'teamName', 'Team': 'teamName', 'Team Name': 'teamName',
};

class ParticipantImportService {
  /**
   * Parse an Excel buffer into an array of row objects.
   * @param {Buffer} buffer - The raw file buffer from multer
   * @returns {{ rows: object[], headers: string[] }}
   * @throws Error if parsing fails or headers are missing
   */
  parseExcel(buffer) {
    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
      throw new Error('Excel文件解析失败');
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel文件解析失败');
    }

    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawData.length === 0) {
      throw new Error('没有有效的数据行');
    }

    // Map headers
    const rawHeaders = Object.keys(rawData[0]);
    const fieldMap = {};

    for (const header of rawHeaders) {
      const trimmed = header.trim();
      if (HEADER_MAP[trimmed]) {
        fieldMap[header] = HEADER_MAP[trimmed];
      }
    }

    // Check required fields exist
    const mappedFields = new Set(Object.values(fieldMap));
    if (!mappedFields.has('name')) {
      throw new Error('Excel文件格式错误，请检查表头');
    }
    if (!mappedFields.has('school')) {
      throw new Error('Excel文件格式错误，请检查表头');
    }

    // Convert rows to normalized format
    const rows = rawData.map((rawRow) => {
      const row = {};
      for (const [rawHeader, fieldName] of Object.entries(fieldMap)) {
        let val = rawRow[rawHeader];
        if (val !== undefined && val !== null) {
          val = String(val).trim();
        } else {
          val = '';
        }
        row[fieldName] = val;
      }
      return row;
    });

    return { rows, headers: Object.values(fieldMap) };
  }

  /**
   * Validate parsed rows.
   * @param {object[]} rows
   * @returns {{ valid: object[], invalid: object[] }}
   *   Each invalid row has an `_error` field explaining the issue.
   */
  validateRows(rows) {
    const valid = [];
    const invalid = [];

    for (let i = 0; i < rows.length; i++) {
      const row = { ...rows[i], _row: i + 2 }; // +2 = Excel row (1-indexed + header)
      const errors = [];

      // Required: name
      if (!row.name || row.name.length === 0) {
        errors.push('缺少姓名');
      }

      // Required: school
      if (!row.school || row.school.length === 0) {
        errors.push('缺少学校名称');
      }

      // Optional validation: age should be a reasonable number
      if (row.age && row.age !== '') {
        const ageNum = parseInt(row.age, 10);
        if (isNaN(ageNum) || ageNum < 3 || ageNum > 99) {
          errors.push('年龄无效（应为3-99）');
        }
        row.age = ageNum;
      }

      if (errors.length > 0) {
        row._error = errors.join('；');
        invalid.push(row);
      } else {
        delete row._error;
        valid.push(row);
      }
    }

    return { valid, invalid };
  }
}

module.exports = ParticipantImportService;
