// Type-safe wrappers around pg's loose `query()`.
//
// NOTE: This file is NOT a Drizzle schema. The original
// `src/lib/db/schema.ts` (Drizzle pgTable definitions) was removed when
// the project standardised on raw SQL migrations under `migrations/`
// + thin pg row wrappers. If you're looking for the canonical table
// shape, read the latest migration file (`migrations/*.sql`) and the
// queries that read it. New contributors occasionally mistake this
// file for the Drizzle layer — the file name was preserved for
// grep-ability of existing imports.
//
// pg's `Pool.query()` and `PoolClient.query()` return
// `Promise<QueryResult>` where `QueryResult.rows` is typed as `any[]`.
// That forces every caller to either `as any` the row or `as { ... }`
// cast to a concrete shape — both of which are easy to get wrong and
// defeat the point of TypeScript.
//
// `queryOne<T>` / `queryMany<T>` push the cast to the boundary so the
// rest of the file is fully typed. They also wrap connection failures
// in a typed `DbError` so callers can distinguish DB errors from
// validation errors without leaking pg internals.

import type { Pool, PoolClient } from 'pg';

/** Anything with a `query()` method compatible with pg's API. */
export interface Queryable {
  query: Pool['query'] | PoolClient['query'];
}

/** Wraps any failure from a pg call so callers can branch on a single type. */
export class DbError extends Error {
  public readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'DbError';
    this.cause = cause;
  }
}

/**
 * Run a query and return the first row, or `null` when there are no
 * rows. Throws `DbError` if the underlying pg call rejects.
 */
export async function queryOne<T = any>(
  q: Queryable,
  text: string,
  params?: unknown[],
): Promise<T | null> {
  try {
    const res = await q.query(text, params);
    const row = res.rows[0];
    return row === undefined ? null : (row as T);
  } catch (err) {
    throw new DbError('queryOne failed', err);
  }
}

/**
 * Run a query and return every row. Throws `DbError` if the underlying
 * pg call rejects.
 */
export async function queryMany<T = any>(
  q: Queryable,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  try {
    const res = await q.query(text, params);
    return res.rows as T[];
  } catch (err) {
    throw new DbError('queryMany failed', err);
  }
}