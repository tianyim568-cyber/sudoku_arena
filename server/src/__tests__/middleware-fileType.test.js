// Unit tests for the validateFileType middleware.
// The middleware checks an uploaded file's REAL content by inspecting the
// first bytes (magic bytes) instead of trusting the client-provided filename
// extension or MIME type — both are spoofable.
// We feed it handcrafted buffers representing each case (xlsx/xls/pdf/csv,
// plus a fake/binary one) and check whether it calls next() or rejects.

const { validateFileType } = require('../middleware/fileType');

// Build minimal req/res/next mocks. req.file.buffer is what the middleware reads.
// We wrap nextCalled in an object so the closure reflects the live value
// (see middleware-validate.test.js for the same pattern).
function buildMocks(buffer) {
  const state = { nextCalled: false };
  const req = buffer ? { file: { buffer } } : { file: null };
  const res = {
    sent: null,
    json(payload) { this.sent = payload; return this; },
  };
  const next = () => { state.nextCalled = true; };
  return { req, res, next, state };
}

describe('validateFileType middleware', () => {
  // Real magic bytes for each supported format.
  // xlsx is a ZIP archive: "PK\x03\x04" = 0x50 0x4b 0x03 0x04.
  const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  // Legacy .xls (OLE2 compound): D0 CF 11 E0 A1 B1 1A E1.
  const XLS_BYTES = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  // PDF: "%PDF-" = 25 50 44 46 2d.
  const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x0a, 0x0a]);

  test('accepts a valid xlsx buffer when xlsx is allowed', () => {
    const middleware = validateFileType(['xlsx']);
    const { req, res, next, state } = buildMocks(XLSX_BYTES);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(true);
    expect(res.sent).toBeNull();
  });

  test('accepts a valid xls buffer when xls is allowed', () => {
    const middleware = validateFileType(['xls']);
    const { req, res, next, state } = buildMocks(XLS_BYTES);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(true);
  });

  test('accepts a valid pdf buffer when pdf is allowed', () => {
    const middleware = validateFileType(['pdf']);
    const { req, res, next, state } = buildMocks(PDF_BYTES);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(true);
  });

  test('rejects an xlsx buffer when only pdf is allowed', () => {
    const middleware = validateFileType(['pdf']);
    const { req, res, next, state } = buildMocks(XLSX_BYTES);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent).not.toBeNull();
    expect(res.sent.code).toBe(40001);
    expect(res.sent.data).toBeNull();
  });

  test('rejects a buffer with garbage bytes (no known signature)', () => {
    const middleware = validateFileType(['xlsx', 'pdf']);
    // Random bytes that match no signature.
    const garbage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG header
    const { req, res, next, state } = buildMocks(garbage);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40001);
  });

  test('rejects when req.file is missing (no file uploaded)', () => {
    const middleware = validateFileType(['xlsx']);
    const { req, res, next, state } = buildMocks(null);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40000);
  });

  test('rejects when req.file.buffer is missing', () => {
    const middleware = validateFileType(['xlsx']);
    const state = { nextCalled: false };
    const req = { file: {} }; // file exists but no buffer
    const res = { sent: null, json(p) { this.sent = p; return this; } };
    const next = () => { state.nextCalled = true; };
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40000);
  });

  test('accepts a CSV buffer (plain text, no NUL bytes)', () => {
    const middleware = validateFileType(['csv']);
    const csv = Buffer.from('name,age\nAlice,30\nBob,25\n', 'utf8');
    const { req, res, next, state } = buildMocks(csv);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(true);
  });

  test('rejects a binary buffer when csv is allowed (NUL bytes present)', () => {
    const middleware = validateFileType(['csv']);
    // Binary content (contains NUL byte) — should not be treated as text.
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const { req, res, next, state } = buildMocks(binary);
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40001);
  });
});
