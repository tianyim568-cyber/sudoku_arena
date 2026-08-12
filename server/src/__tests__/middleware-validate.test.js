// Unit tests for the validate middleware.
// The middleware wraps a Zod schema and checks req.body against it:
//   - valid body  -> calls next() (request continues)
//   - invalid body -> responds with the app's error envelope (code 40001) and stops
// We test it in isolation by building fake req/res/next objects.

const { validateBody } = require('../middleware/validate');
const { z } = require('zod');

// Build a minimal mock of Express's req/res/next trio.
// We only need the parts the middleware actually touches.
// `nextCalled` is wrapped in an object so tests can read its live value
// (closures capture variables, not values — destructuring would freeze it).
function buildMocks(body) {
  const state = { nextCalled: false };
  const req = { body };
  const res = {
    sent: null,
    json(payload) { this.sent = payload; return this; },
  };
  const next = () => { state.nextCalled = true; };
  return { req, res, next, state };
}

describe('validate middleware', () => {
  // A small schema reused across tests: { name: string min 1, age: positive int }.
  const schema = z.object({
    name: z.string().min(1),
    age: z.coerce.number().int().positive(),
  });
  const middleware = validateBody(schema);

  test('calls next() when body matches the schema', () => {
    const { req, res, next, state } = buildMocks({ name: 'Alice', age: 30 });
    middleware(req, res, next);
    expect(state.nextCalled).toBe(true);
    expect(res.sent).toBeNull();
  });

  test('responds with code 40001 when a required field is missing', () => {
    const { req, res, next, state } = buildMocks({ age: 30 }); // no name
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent).not.toBeNull();
    expect(res.sent.code).toBe(40001);
    expect(res.sent.data).toBeNull();
  });

  test('responds with code 40001 when a field fails validation', () => {
    const { req, res, next, state } = buildMocks({ name: 'Alice', age: -5 }); // age not positive
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40001);
  });

  test('includes a non-empty error message on failure', () => {
    const { req, res, next } = buildMocks({ name: '', age: 0 });
    middleware(req, res, next);
    expect(typeof res.sent.message).toBe('string');
    expect(res.sent.message.length).toBeGreaterThan(0);
  });

  test('rejects an empty body when the schema requires fields', () => {
    const { req, res, next, state } = buildMocks({});
    middleware(req, res, next);
    expect(state.nextCalled).toBe(false);
    expect(res.sent.code).toBe(40001);
  });
});
