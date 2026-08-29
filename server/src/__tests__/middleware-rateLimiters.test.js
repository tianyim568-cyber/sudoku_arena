// Unit tests for the rateLimiters module.
// The module exports three shared express-rate-limit middlewares: authLimiter
// (brute-force protection on login), expensiveLimiter (CPU-expensive
// operations like puzzle generation), and registerLimiter (stricter ceiling
// for organization registration).
// Per the prompt, we do a BASIC config check here — not a 30-request flood
// simulation. We verify the public contract: all middlewares exist, are
// functions, are distinct, and (when mounted on a real Express app) let a
// single request pass through with HTTP 200. Driving them through supertest
// gives the middleware a fully-formed req object, which it needs in order to
// compute the client IP.

const express = require('express');
const request = require('supertest');
const { authLimiter, expensiveLimiter, registerLimiter } = require('../middleware/rateLimiters');

// Build a tiny Express app that mounts the given middleware on a single route.
// We use a fresh app per test so the rate-limit counter starts at zero.
function buildApp(middleware) {
  const app = express();
  app.use(express.json());
  // The route handler runs only if the limiter calls next().
  app.post('/limited', middleware, (req, res) => {
    res.json({ code: 200, message: 'success', data: { passed: true } });
  });
  return app;
}

describe('rateLimiters module', () => {
  test('authLimiter is defined and is a function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  test('expensiveLimiter is defined and is a function', () => {
    expect(typeof expensiveLimiter).toBe('function');
  });

  test('authLimiter and expensiveLimiter are distinct instances', () => {
    // They must NOT be the same middleware — different limits/purposes.
    // Sharing one instance would let login traffic deplete the puzzle-gen quota.
    expect(authLimiter).not.toBe(expensiveLimiter);
  });

  test('authLimiter lets a single request through (HTTP 200)', async () => {
    const app = buildApp(authLimiter);
    const res = await request(app).post('/limited').send({});
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.passed).toBe(true);
  });

  test('expensiveLimiter lets a single request through (HTTP 200)', async () => {
    const app = buildApp(expensiveLimiter);
    const res = await request(app).post('/limited').send({});
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.passed).toBe(true);
  });

  test('authLimiter does NOT return 429 on the first request', async () => {
    const app = buildApp(authLimiter);
    const res = await request(app).post('/limited').send({});
    expect(res.status).not.toBe(429);
  });

  test('registerLimiter is defined and is a function', () => {
    expect(typeof registerLimiter).toBe('function');
  });

  test('registerLimiter is distinct from authLimiter and expensiveLimiter', () => {
    // registerLimiter has a stricter ceiling (max: 10 vs 30) — it must be a
    // separate instance so registration traffic doesn't deplete the login
    // quota and vice versa.
    expect(registerLimiter).not.toBe(authLimiter);
    expect(registerLimiter).not.toBe(expensiveLimiter);
  });

  test('registerLimiter lets a single request through (HTTP 200)', async () => {
    const app = buildApp(registerLimiter);
    const res = await request(app).post('/limited').send({});
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.passed).toBe(true);
  });

  // ── IPv6 keyGenerator validation (express-rate-limit v7+) ────────
  // The library throws at construction time if a custom keyGenerator
  // reads req.ip without routing it through ipKeyGenerator. Requiring
  // the module fresh proves construction succeeds, and driving it with
  // a synthetic IPv6 request proves the key is a subnet-normalized
  // string (not the raw IPv6 address).
  test('expensiveLimiter construction passes IPv6 validation (no ValidationError)', () => {
    expect(() => {
      // Bust the require cache so the module (and its rateLimit() calls)
      // re-execute — the v7+ validation runs at construction time.
      jest.resetModules();
      require('../middleware/rateLimiters');
    }).not.toThrow();
  });

  test('keyByUserOrIp prefers userId, falls back to normalized IPv6', () => {
    const { keyByUserOrIp } = require('../middleware/rateLimiters');
    // Authenticated request: the user id wins over any IP.
    expect(keyByUserOrIp({ user: { userId: 'user-123' }, ip: '1.2.3.4' })).toBe('user-123');
    // Anonymous IPv4: returned as-is (no subnet work needed).
    expect(keyByUserOrIp({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    // Anonymous IPv6: normalized to a /56 subnet prefix, not the raw address.
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    expect(keyByUserOrIp({ ip: ipv6 })).not.toBe(ipv6);
    expect(typeof keyByUserOrIp({ ip: ipv6 })).toBe('string');
    // Nothing at all: stable anonymous bucket.
    expect(keyByUserOrIp({})).toBe('anonymous');
  });
});
