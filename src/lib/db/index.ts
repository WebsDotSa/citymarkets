import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { getDatabaseConfig, isProd } from '@/lib/env';
import { debug as logDebug, error as logError } from '@/lib/logger';

/** Max chars of normalized SQL snippet in development logs */
const MAX_SQL_PREVIEW = 500;

type QueryValues = unknown[] | undefined;

function normalizeQueryArgs(args: readonly unknown[]): { sql: string; values?: QueryValues } {
  const [first, second] = args;
  if (typeof first === 'string') {
    return {
      sql: first,
      values: Array.isArray(second) ? [...second] : undefined,
    };
  }
  if (
    first &&
    typeof first === 'object' &&
    'text' in first &&
    typeof (first as { text?: unknown }).text === 'string'
  ) {
    const o = first as { text: string; values?: unknown[] };
    return { sql: o.text, values: o.values !== undefined ? [...o.values] : undefined };
  }
  return { sql: String(first ?? '') };
}

function previewSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, MAX_SQL_PREVIEW);
}

function redactScalar(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const n = value.length;
    return n <= 8 ? `[str:${n}]` : `[str:len:${n}]`;
  }
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return value;
  if (typeof value === 'object' && value instanceof Date) return '[date]';
  if (typeof Buffer !== 'undefined' && typeof value === 'object' && Buffer.isBuffer(value))
    return `[buf:${(value as Buffer).length}]`;
  if (Array.isArray(value)) return `[arr:${value.length}]`;
  if (t === 'object') return '[object]';
  return '[unknown]';
}

function redactParams(params?: QueryValues): unknown[] | undefined {
  if (!params?.length) return params;
  return params.map(redactScalar);
}

/** Successful-query logging in prod: only durations/counts — no SQL, no params. */
function isProdDbVerbose(): boolean {
  return process.env.DB_QUERY_LOG === 'true' || process.env.DB_QUERY_LOG === '1';
}

function logQuerySuccess(sql: string, values: QueryValues, durationMs: number, rows: number | null): void {
  if (isProd) {
    if (!isProdDbVerbose()) return;
    logDebug('db query', {
      ms: durationMs,
      rows,
      params: values?.length ?? 0,
    });
    return;
  }
  logDebug('db query', {
    ms: durationMs,
    rows,
    sql: previewSql(sql),
    params: redactParams(values),
  });
}

function logQueryError(sql: string, durationMs: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isProd) {
    logError('db query failed', error, { ms: durationMs, message });
    return;
  }
  logError('db query failed', error, {
    ms: durationMs,
    sql: previewSql(sql),
    message,
  });
}

function tracedQuery(
  run: (...a: Parameters<typeof Pool.prototype.query>) => Promise<QueryResult>,
  callArgs: Parameters<typeof Pool.prototype.query>
): Promise<QueryResult> {
  const { sql, values } = normalizeQueryArgs(callArgs as unknown[]);
  const t0 = Date.now();
  return run(...callArgs)
    .then((res: QueryResult) => {
      logQuerySuccess(sql, values, Date.now() - t0, res.rowCount);
      return res;
    })
    .catch((error: unknown) => {
      logQueryError(sql, Date.now() - t0, error);
      throw error;
    });
}

/** One pool per Node process — avoids Next.js duplicating pools per route bundle. */
const globalForPg = globalThis as typeof globalThis & {
  __citymarketPgPool?: Pool;
};

function createPgPool(): Pool {
  return new Pool(getDatabaseConfig());
}

const pgPool = globalForPg.__citymarketPgPool ?? createPgPool();
globalForPg.__citymarketPgPool = pgPool;

const nativePoolQuery = pgPool.query.bind(pgPool);
(pgPool as Pool).query = ((...callArgs: Parameters<typeof pgPool.query>) =>
  tracedQuery(nativePoolQuery, callArgs)) as typeof pgPool.query;

export const pool = pgPool;

/** Run a parameterized query (recommended). Logs in dev only, with redacted params.
 *  Generic defaults to `any` so existing callers that cast `rows.map((r: T) => ...)`
 *  don't break; specify `<T extends QueryResultRow>` at the call site when you
 *  want strict row typing. */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (params?.length) {
    return pgPool.query(text, params) as unknown as QueryResult<T>;
  }
  return pgPool.query(text) as unknown as QueryResult<T>;
}
