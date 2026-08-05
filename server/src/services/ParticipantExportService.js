/**
 * Participant Export Service — generates Excel files for credential distribution.
 * Pure service layer with no Express dependency.
 */

const XLSX = require('xlsx');

class ParticipantExportService {
  /**
   * Generate an Excel buffer from participant data with credentials.
   * @param {object[]} rows - each: { id, school_name, name, category, account, password }
   * @returns {Buffer} xlsx file buffer
   */
  generateExportBuffer(rows) {
    // Map to Chinese headers
    const exportData = rows.map((r) => ({
      '编号': r.id,
      '学校': r.school_name || '-',
      '姓名': r.name,
      '组别': r.category || '-',
      '账号': r.account || '-',
      '密码': r.password || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);

    // Set column widths
    ws['!cols'] = [
      { wch: 8 },   // 编号
      { wch: 30 },  // 学校
      { wch: 15 },  // 姓名
      { wch: 12 },  // 组别
      { wch: 18 },  // 账号
      { wch: 12 },  // 密码
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '选手信息');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = ParticipantExportService;
