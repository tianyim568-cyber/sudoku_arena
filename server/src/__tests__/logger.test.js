// Tests for the structured logger (utils/logger.js).
//
// What we verify (per the prompt's spec — these are the two cases that matter):
//   1. A secret doesn't end up in the output.
//      - A logged object with a `password` key must show [REDACTED], not the value.
//      - A logged connection string (redis://:pass@host) must show ***@, not the password.
//   2. The app survives a logger failure.
//      - If the underlying Pino instance throws, logger.error/info/warn return
//        normally — no exception bubbles up to the caller. The request that
//        triggered the log continues.
//      - The `child()` method also degrades gracefully.
//
// How we verify: we spy on the underlying Pino instance's methods directly.
// Pino writes to stdout via SonicBoom (a raw fs.writeSync), which is hard to
// intercept portably — so we test what REACHES Pino (post-sanitize) instead
// of what comes out of stdout. This is actually the better seam: if the
// sanitized args don't contain the secret, the secret cannot be in the output.

const logger = require('../utils/logger');

// In test env, the logger exposes its Pino instance via __pino. We spy on it.
// Each test restores the original implementation in afterEach.
const pinoInstance = logger.__pino;

function spyOnPinoMethod(methodName) {
  const calls = [];
  const original = pinoInstance[methodName].bind(pinoInstance);
  // Pino supports two call signatures:
  //   pino.info(message)           -> message is the only arg
  //   pino.info(mergingObj, msg)   -> obj first, msg second
  // Our emit() always calls one of these two forms. Normalize into {obj, msg}.
  pinoInstance[methodName] = (...args) => {
    if (args.length <= 1) {
      calls.push({ obj: undefined, msg: args[0] });
    } else {
      calls.push({ obj: args[0], msg: args[1] });
    }
  };
  return {
    calls,
    restore() { pinoInstance[methodName] = original; },
  };
}

describe('logger: secrets never leak', () => {
  test('a `password` key is replaced with [REDACTED]', () => {
    const spy = spyOnPinoMethod('info');
    logger.info('User login', { username: 'admin', password: 'super-secret-123' });
    spy.restore();

    expect(spy.calls).toHaveLength(1);
    const { obj, msg } = spy.calls[0];
    expect(msg).toBe('User login');
    expect(obj.username).toBe('admin');
    expect(obj.password).toBe('[REDACTED]');
    // The actual secret value must NOT appear anywhere in the sanitized args.
    const serialized = JSON.stringify({ msg, obj });
    expect(serialized).not.toContain('super-secret-123');
  });

  test('a `token` key is replaced with [REDACTED]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-part';
    const spy = spyOnPinoMethod('info');
    logger.info('Token issued', { token: jwt });
    spy.restore();

    expect(spy.calls[0].obj.token).toBe('[REDACTED]');
    expect(JSON.stringify(spy.calls[0])).not.toContain(jwt);
  });

  test('an `authorization` header value is replaced with [REDACTED]', () => {
    const spy = spyOnPinoMethod('debug');
    logger.debug('Request', { url: '/api/auth/login', authorization: 'Bearer abc.def.ghi' });
    spy.restore();

    expect(spy.calls[0].obj.authorization).toBe('[REDACTED]');
    expect(JSON.stringify(spy.calls[0])).not.toContain('Bearer abc.def.ghi');
  });

  test('a connection string with embedded credentials is masked', () => {
    const spy = spyOnPinoMethod('info');
    logger.info('Connected to Redis', { url: 'redis://:s3cr3t@localhost:6379' });
    spy.restore();

    const url = spy.calls[0].obj.url;
    expect(url).toContain('redis://');
    expect(url).toContain('localhost:6379');
    expect(url).not.toContain('s3cr3t');
    expect(url).toContain('***@');
  });

  test('a postgres connection string with user:pass is masked', () => {
    const spy = spyOnPinoMethod('info');
    logger.info('PostgreSQL connected', { url: 'postgres://dbuser:hunter2@db:5432/arena' });
    spy.restore();

    const url = spy.calls[0].obj.url;
    expect(url).not.toContain('hunter2');
    expect(url).not.toContain('dbuser');
    expect(url).toContain('***@');
    expect(url).toContain('db:5432');
  });

  test('nested sensitive keys are masked at every level', () => {
    const spy = spyOnPinoMethod('error');
    logger.error('Auth flow failed', {
      step: 'login',
      user: { username: 'louise', password: 'p4ssw0rd' },
      request: { headers: { authorization: 'Bearer xyz' } },
    });
    spy.restore();

    const serialized = JSON.stringify(spy.calls[0]);
    expect(serialized).not.toContain('p4ssw0rd');
    expect(serialized).not.toContain('Bearer xyz');
    expect(serialized).toContain('[REDACTED]');
  });

  test('circular references do not crash the logger', () => {
    const a = { name: 'a' };
    a.self = a; // circular
    const spy = spyOnPinoMethod('info');
    // Must not throw — sanitize handles the cycle.
    expect(() => {
      logger.info('Circular test', { obj: a });
    }).not.toThrow();
    spy.restore();

    const serialized = JSON.stringify(spy.calls[0]);
    expect(serialized).toContain('[Circular]');
  });

  test('a top-level string value with credentials is masked', () => {
    // When the second arg is a string (not an object), Pino treats it as the
    // message and there's no mergingKey object. Our logger passes it through
    // sanitize -> maskConnectionString, so the creds get masked.
    const spy = spyOnPinoMethod('info');
    logger.info('Connected', 'redis://:topsecret@cache:6379');
    spy.restore();

    // Pino's info(obj, msg) signature: when called with a string first, it's
    // treated as the message. Our emit() passes sanitize(obj) then message.
    // If obj is a string, sanitize returns the masked string.
    // We just verify the secret didn't leak through.
    const serialized = JSON.stringify(spy.calls[0]);
    expect(serialized).not.toContain('topsecret');
  });
});

describe('logger: survives its own failure', () => {
  // We force Pino to throw by replacing its method with one that raises. The
  // logger's emit() wraps the call in try/catch — the exception must NOT
  // escape to the caller. This is the "logger must never crash the server"
  // guarantee: if the underlying transport dies (disk full, broken pipe),
  // the request that triggered the log still completes.

  test('logger.info does not throw when Pino throws', () => {
    const original = pinoInstance.info;
    pinoInstance.info = () => { throw new Error('disk full / broken pipe'); };
    try {
      expect(() => {
        logger.info('This should not crash', { ok: true });
      }).not.toThrow();
    } finally {
      pinoInstance.info = original;
    }
  });

  test('logger.error does not throw when Pino throws', () => {
    const original = pinoInstance.error;
    pinoInstance.error = () => { throw new Error('EPIPE'); };
    try {
      expect(() => {
        logger.error('DB down', { error: 'connection refused' });
      }).not.toThrow();
    } finally {
      pinoInstance.error = original;
    }
  });

  test('logger.warn does not throw when Pino throws', () => {
    const original = pinoInstance.warn;
    pinoInstance.warn = () => { throw new Error('write failed'); };
    try {
      expect(() => {
        logger.warn('Rate limit hit', { ip: '10.0.0.1' });
      }).not.toThrow();
    } finally {
      pinoInstance.warn = original;
    }
  });

  test('logger.debug does not throw when Pino throws', () => {
    const original = pinoInstance.debug;
    pinoInstance.debug = () => { throw new Error('boom'); };
    try {
      expect(() => {
        logger.debug('Debug detail', { step: 3 });
      }).not.toThrow();
    } finally {
      pinoInstance.debug = original;
    }
  });

  test('logger.child returns a usable logger even if child() were to fail', () => {
    // Normal case: child() succeeds and produces a sub-logger.
    const child = logger.child({ component: 'auth' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.error).toBe('function');

    // The child logger must also survive Pino failure.
    const original = pinoInstance.child;
    pinoInstance.child = () => { throw new Error('child boom'); };
    try {
      // When child() throws, the catch returns the parent logger — so we get
      // back a working logger (the parent), not a broken child.
      const fallbackChild = logger.child({ component: 'auth' });
      expect(typeof fallbackChild.info).toBe('function');
      expect(() => {
        fallbackChild.info('Still works', { userId: 42 });
      }).not.toThrow();
    } finally {
      pinoInstance.child = original;
    }
  });

  test('a child logger does not throw when its Pino method throws', () => {
    const child = logger.child({ component: 'engine' });
    const original = pinoInstance.info;
    pinoInstance.info = () => { throw new Error('child pipe broke'); };
    try {
      expect(() => {
        child.info('Child message', { userId: 42 });
      }).not.toThrow();
    } finally {
      pinoInstance.info = original;
    }
  });
});

describe('logger: API contract', () => {
  test('logger.info(message) with no obj works', () => {
    const spy = spyOnPinoMethod('info');
    logger.info('Server started');
    spy.restore();

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].msg).toBe('Server started');
  });

  test('logger.error(message, obj) includes both message and obj fields', () => {
    const spy = spyOnPinoMethod('error');
    logger.error('Registration failed', { username: 'newuser', error: 'duplicate' });
    spy.restore();

    expect(spy.calls[0].msg).toBe('Registration failed');
    expect(spy.calls[0].obj.username).toBe('newuser');
    expect(spy.calls[0].obj.error).toBe('duplicate');
  });
});
