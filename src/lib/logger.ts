/**
 * Structured logging utility
 * 
 * Provides consistent logging across the application with:
 * - Environment-aware logging (development vs production)
 * - Structured log levels (debug, info, warn, error)
 * - Request ID tracking for debugging
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const CURRENT_LEVEL = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 
  (process.env.NODE_ENV === 'production' ? 'warn' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Log a debug message (development only by default)
 */
export function debug(message: string, meta?: Record<string, unknown>): void {
  if (shouldLog('debug')) {
    console.debug(formatMessage('debug', message, meta));
  }
}

/**
 * Log an info message
 */
export function info(message: string, meta?: Record<string, unknown>): void {
  if (shouldLog('info')) {
    console.info(formatMessage('info', message, meta));
  }
}

/**
 * Log a warning message
 */
export function warn(message: string, meta?: Record<string, unknown>): void {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message, meta));
  }
}

/**
 * Log an error message
 */
export function error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
  if (shouldLog('error')) {
    const errorMeta = error instanceof Error 
      ? { error: error.message, stack: error.stack, ...meta }
      : { error: String(error), ...meta };
    console.error(formatMessage('error', message, errorMeta));
  }
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(requestId: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) =>
      debug(`[${requestId}] ${msg}`, meta),
    info: (msg: string, meta?: Record<string, unknown>) =>
      info(`[${requestId}] ${msg}`, meta),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      warn(`[${requestId}] ${msg}`, meta),
    error: (msg: string, err?: unknown, meta?: Record<string, unknown>) =>
      error(`[${requestId}] ${msg}`, err, meta),
  };
}

// NOTE: `silentConsole` was previously exported here to bypass formatting
// for ad-hoc logs. It leaked `console.info/warn/error` past the LOG_LEVEL
// gate, which defeated the prod-vs-dev split. Removed — anyone reaching
// for a raw console call in a route or component should import the
// structured `debug/info/warn/error` exports above instead. If a raw
// console call is genuinely necessary (e.g. inside the Sentry transport
// itself), inline `console.*` at the call site so it's grep-able.
