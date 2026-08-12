// Validate that an uploaded file's ACTUAL content matches an allowed type,
// by inspecting its magic bytes (the file signature) instead of trusting the
// client-provided filename extension or MIME type — both are spoofable.
// Runs after multer has populated req.file, before the file reaches any parser.

// A file's first bytes reveal its real format. Each entry answers:
// "does this buffer look like a real <type>?".
const SIGNATURES = {
  // .xlsx (and every OOXML file) is a ZIP archive -> starts with "PK\x03\x04".
  // Note: .docx/.pptx share this signature; the downstream spreadsheet parser
  // is what confirms it is specifically a worksheet.
  xlsx: (buf) =>
    buf.length >= 4 &&
    buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04,

  // .xls (legacy OLE2 compound file).
  xls: (buf) =>
    buf.length >= 8 &&
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
    buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1,

  // .pdf -> starts with "%PDF-". Ready for REQ-03 (puzzle upload).
  pdf: (buf) =>
    buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d,

  // .csv has no magic number (it is plain text). We can only confirm it is
  // text, not binary; the row/header validation downstream does the rest.
  csv: (buf) => looksLikeText(buf),
};

// Binary files (executables, images, ZIP archives) contain NUL bytes; plain
// text files do not. Sampling the start is enough to tell them apart.
function looksLikeText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.length === 0) return false;
  for (const byte of sample) {
    if (byte === 0x00) return false;
  }
  return true;
}

// Middleware factory: validateFileType(['xlsx', 'xls', 'csv']) returns a
// middleware that lets the request through only if req.file's real content
// matches at least one allowed type.
function validateFileType(allowedTypes) {
  return (req, res, next) => {
    if (!req.file || !req.file.buffer) {
      return res.json({ code: 40000, message: '请上传文件', data: null });
    }
    const buf = req.file.buffer;
    const matches = allowedTypes.some((type) => {
      const check = SIGNATURES[type];
      return check ? check(buf) : false;
    });
    if (!matches) {
      return res.json({ code: 40001, message: '文件内容与类型不符，请上传有效的文件', data: null });
    }
    next();
  };
}

module.exports = { validateFileType };
