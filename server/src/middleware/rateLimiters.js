const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Shared rate limiters, defined once and reused across routes (DRY).
// Each limiter counts requests per client inside a time window and replies
// 429 once the max is exceeded, without running the route.
//
// ── ISSUE-019 fix (2026-08-24) ──────────────────────────────────────
// The previous ceiling (30 login attempts / 15 min / IP) blocked a real
// on-site competition: a school room of > 30 players sits behind ONE
// public IP (router NAT), so the 31st player logging in got 429 from
// nowhere. Sudoku Arena's actual use case is 100+ people logging in
// from the same building in a few minutes.
//
// Two mitigations, both applied here:
//
//   1. Raise the login window ceiling to a value that a full room can
//      pass. 200 is comfortable for a class of 100 with retries, and
//      remains a hard cliff for a brute-force script.
//
//   2. For expensive/admin routes that DO have a user id (post-login),
//      key the limiter by userId when available, falling back to IP
//      otherwise. A malicious admin still cannot spam puzzle
//      generation, but two admins sharing one office IP don't compete
//      for the same 30-token bucket.
//
// register stays at 10/15min (a very rare, human-driven action).

// Post-login limiter helper: key by the authenticated userId when the
// request has one, otherwise fall back to the client IP. Never returns
// undefined — an undefined key would collapse every anonymous request
// into one bucket, which is worse than the IP fallback.
// The IP fallback goes through the library's ipKeyGenerator helper, which
// normalizes IPv6 addresses into /56 subnets. express-rate-limit v7+
// validates custom keyGenerators at construction time and throws if they
// read req.ip without using ipKeyGenerator (an IPv6 rotation bypass).
function keyByUserOrIp(req) {
  if (req.user && req.user.userId) return req.user.userId;
  if (req.ip) return ipKeyGenerator(req.ip);
  return 'anonymous';
}

// Strict limiter for authentication attempts (brute-force protection).
// Pre-login: no user id available, key by IP. Raised to 200/15min so a
// full competition room (behind one NAT) can log in without hitting
// the ceiling. Still low enough that a scripted brute-force stalls
// after ~200 attempts within 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for CPU-expensive operations (e.g. Sudoku puzzle generation).
// Admin-only and rarely triggered in normal use. Keyed by userId when
// available (all these routes run after authMiddleware, so req.user is
// populated) — two admins on the same office IP don't compete.
const expensiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: keyByUserOrIp,
  message: { code: 429, message: '操作过于频繁，请稍后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for organization registration (stricter than login: an org is
// a heavier object to create, and registration is a one-shot human
// action). Kept IP-keyed on purpose — no user yet, and one IP creating
// 10 orgs in a row is a red flag whether or not the same person is
// behind it.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { code: 429, message: '注册尝试过于频繁，请15分钟后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, expensiveLimiter, registerLimiter, keyByUserOrIp };
