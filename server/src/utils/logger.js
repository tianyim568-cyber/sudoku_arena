/**
 * Structured logger for the Sudoku Arena server.
 *
 * Design choices (decided once, documented here so future readers don't
 * re-litigate them):
 *
 * 1. Library: Pino. Faster and lighter than Winston, JSON-native, and the
 *    API is small. We don't need transports or custom formats — just
 *    structured output.
 *
 * 2. Format: pretty (colorized, indented) in development for the dev reading
 *    the terminal; raw JSON in production for a log aggregator (ELK, Loki,
 *    Datadog) to ingest. Pino handles both natively via pino-pretty.
 *
 * 3. Default level: 'debug' in dev (the dev wants everything), 'info' in prod
 *    (operational signal without noise).
 *
 * 4. A logger must NEVER crash the server. Every public method is wrapped in
 *    try/catch and falls back to console.error if Pino itself fails (disk
 *    full, broken pipe). The same principle as the React ErrorBoundary: the
 *    safety net is not the point of failure.
 *
 * 5. Secrets must NEVER appear in logs. The sanitize pass walks objects
 *    before they're logged and masks any key that looks sensitive
 *    (password, token, authorization, secret, jwt, etc.), plus connection
 *    strings with embedded credentials (redis://:password@host,
 *    postgres://user:pass@host). This is defense-in-depth: callers should
 *    not log secrets in the first place, but the logger catches slips.
 *
 * Usage:
 *   const logger = require('../utils/logger');
 *   logger.info('Server started', { port: 3001 });
 *   logger.error('Registration failed', { error: err.message, username });
 *   logger.warn('Redis unavailable, falling back to in-memory', { error });
 *
 * The first arg is the human-readable message; the optional second is a
 * structured object whose keys become fields in the JSON output. Pino's
 * convention. Don't pass the message as part of the object.
 */

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Silent under the test runner. Application logs interleaved with test output
// bury the one line that matters when something fails, and they would flood
// CI. The logger's own tests spy on the Pino instance's methods, so they
// intercept the call before the level is consulted and keep working.
// LOG_LEVEL still overrides, for the rare test one wants to watch.
const defaultLevel = isTest ? 'silent' : isProduction ? 'info' : 'debug';

// Keys whose values are masked when they appear in a logged object. Matched
// case-insensitively against the key name. This is intentionally broad —
// false positives (a key called "passwordHint" whose value isn't secret)
// are acceptable; false negatives (a real secret slipping through) are not.
const SENSITIVE_KEY_PATTERNS = [
  /^password$/i,
  /^password_hash$/i,
  /^passwd$/i,
  /^pwd$/i,
  /^token$/i,
  /^access_token$/i,
  /^refreshtoken$/i,
  /^authorization$/i,
  /^auth$/i,
  /^secret$/i,
  /^jwt$/i,
  /^jwt_secret$/i,
  /^api_key$/i,
  /^apikey$/i,
  /^private_key$/i,
  /^cookie$/i,
  /^session_id$/i,
  /^csrf$/i,
];

// Connection-string patterns. Matches redis://:pass@host, redis://user:pass@host,
// postgres://user:pass@host, mongodb://user:pass@host — anything with
// credentials (a :pass, optionally preceded by a user) between // and @.
// The password is mandatory for a match; a bare user without password is
// rare and less sensitive. Replaces the credentials with *** while keeping
// the scheme + host visible (so the log still says "Connected to Redis at
// redis://***@host:6379").
const CREDENTIAL_PATTERN = /(\/\/)([^:@/]*)(:[^@/]+)?@/g;

/**
 * Mask a single value if it's a connection string with embedded credentials.
 * Returns the masked string, or the original value if it's not a string /
 * doesn't match. Used for top-level values that aren't inside an object.
 */
function maskConnectionString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(CREDENTIAL_PATTERN, '$1***@');
}

/**
 * Sanitize an arbitrary value for logging.
 * - Objects: walk recursively, mask sensitive keys, return a new object.
 *   We never mutate the caller's object — they might still need the real
 *   value (e.g. the password for bcrypt comparison).
 * - Strings: mask embedded connection-string credentials.
 * - Arrays: sanitize each element.
 * - Primitives: pass through.
 *
 * Circular references are handled by replacing the back-reference with
 * '[Circular]' — otherwise JSON.stringify throws and the logger would crash.
 */
function sanitize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return maskConnectionString(value);
  }

  // Circular reference guard.
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, seen));
  }

  // Error objects: extract the useful fields, don't walk the full prototype
  // chain (which can include sensitive stack internals on some engines).
  if (value instanceof Error) {
    const obj = {
      name: value.name,
      message: maskConnectionString(value.message),
      ...(value.code ? { code: value.code } : {}),
      ...(value.stack && !isProduction ? { stack: value.stack } : {}),
    };
    return obj;
  }

  const sanitized = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitize(value[key], seen);
    }
  }
  return sanitized;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

// Build the underlying Pino instance. In dev, route through pino-pretty for
// colorized, indented output that a human can read. In prod, write raw JSON
// to stdout — that's what log aggregators expect.
const pinoOptions = {
  level: process.env.LOG_LEVEL || defaultLevel,
  // Attach a stable app name + env so a downstream aggregator can filter.
  base: { app: 'sudoku-arena', env: process.env.NODE_ENV || 'development' },
  // ISO timestamps are unambiguous and parseable by every aggregator.
  timestamp: pino.stdTimeFunctions.isoTime,
};

let pinoInstance;
if (!isProduction) {
  try {
    const pretty = require('pino-pretty');
    pinoInstance = pino(pinoOptions, pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
    }));
  } catch (_) {
    // pino-pretty not installed — fall back to raw JSON. Still works, just
    // less readable in the terminal.
    pinoInstance = pino(pinoOptions);
  }
} else {
  pinoInstance = pino(pinoOptions);
}

/**
 * Public logger API. Each method sanitizes its args, then delegates to Pino
 * inside a try/catch. If Pino throws (disk full, broken pipe), we fall back
 * to console.error — and if THAT throws too, we swallow. The server stays
 * up.
 *
 * Signature:
 *   logger.info(message, obj?)
 *   logger.warn(message, obj?)
 *   logger.error(message, obj?)
 *   logger.debug(message, obj?)
 *   logger.fatal(message, obj?)  // also calls process.exit(1) — for true start-up failures
 *
 * The message is always the first arg, a string. The optional obj is
 * structured fields. This matches Pino's convention and keeps logs greppable:
 *   logger.error('Registration failed', { username, error: err.message });
 * not
 *   logger.error({ msg: 'Registration failed', username, error: err.message });
 */
function emit(level, message, obj) {
  try {
    if (obj !== undefined && obj !== null) {
      pinoInstance[level](sanitize(obj), message);
    } else {
      pinoInstance[level](message);
    }
  } catch (logErr) {
    // Pino itself failed. Try console as a last resort.
    try {
      // eslint-disable-next-line no-console
      console.error(`[logger-fallback] ${level}: ${message}`, logErr.message);
    } catch (_) {
      // Even console is broken. Nothing left to do — swallow so the caller's
      // request still succeeds.
    }
  }
}

const logger = {
  debug: (msg, obj) => emit('debug', msg, obj),
  info: (msg, obj) => emit('info', msg, obj),
  warn: (msg, obj) => emit('warn', msg, obj),
  error: (msg, obj) => emit('error', msg, obj),
  // fatal is different: it logs THEN exits. Reserved for true unrecoverable
  // start-up failures (missing JWT_SECRET, can't bind port). Don't use it
  // for request-level errors — those are `error`.
  fatal: (msg, obj) => {
    emit('fatal', msg, obj);
    process.exit(1);
  },
  // Exposed for tests and for callers who need to log a raw Error directly
  // (Pino handles Error instances specially — it pulls name/message/stack).
  // We still sanitize, so the Error's message gets credential-masking.
  child: (bindings) => {
    try {
      const childPino = pinoInstance.child(sanitize(bindings || {}));
      return {
        debug: (msg, obj) => safeChildEmit(childPino, 'debug', msg, obj),
        info: (msg, obj) => safeChildEmit(childPino, 'info', msg, obj),
        warn: (msg, obj) => safeChildEmit(childPino, 'warn', msg, obj),
        error: (msg, obj) => safeChildEmit(childPino, 'error', msg, obj),
      };
    } catch (_) {
      // child() failed — return the parent logger as a fallback.
      return logger;
    }
  },
};

function safeChildEmit(childPino, level, message, obj) {
  try {
    if (obj !== undefined && obj !== null) {
      childPino[level](sanitize(obj), message);
    } else {
      childPino[level](message);
    }
  } catch (_) {
    // Child logger failed — fall back silently. Parent logger is still
    // available for future calls.
  }
}

module.exports = logger;

// Exposed for tests only. Not part of the public API — application code must
// not reach in and call pinoInstance directly. Tests use it to spy on what
// reaches Pino (after sanitize) and to force Pino to throw.
if (process.env.NODE_ENV === 'test') {
  logger.__pino = pinoInstance;
}
