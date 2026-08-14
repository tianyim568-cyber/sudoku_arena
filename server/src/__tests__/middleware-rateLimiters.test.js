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
});
