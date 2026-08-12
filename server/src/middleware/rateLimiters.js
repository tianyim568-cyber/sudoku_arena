const rateLimit = require('express-rate-limit');

// Shared rate limiters, defined once and reused across routes (DRY).
// Each limiter counts requests per client (per IP by default) inside a time
// window and replies 429 once the max is exceeded, without running the route.

// Strict limiter for authentication attempts (brute-force protection).
// 30 requests per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for CPU-expensive operations (e.g. Sudoku puzzle generation).
// These are admin-only and rarely triggered in normal use, so a low ceiling
// protects the server from being flooded and saturating the CPU.
// 30 requests per 15 minutes per IP.
const expensiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { code: 429, message: '操作过于频繁，请稍后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, expensiveLimiter };
