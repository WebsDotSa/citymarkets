/**
 * Centralised token_version comparison.
 *
 * Why this exists
 * ---------------
 * Three identity paths (customer, admin, vendor) each sign a JWT with
 * a `tokenVersion` claim equal to the row's `token_version` at sign
 * time. On every request the verify path SELECTs the row's current
 * `token_version` and rejects if the JWT's claim doesn't match. The
 * pattern is identical across the three paths — but until now it was
 * inlined into each (src/lib/identity/auth-helpers.ts,
 * src/lib/identity/admin-api-auth-db.ts,
 * src/lib/identity/vendor-auth-with-db.ts).
 *
 * That made it easy to drift. The audit (PCP-144, 2026-10-03) found
 * that earlier rounds (PCP-128, PCP-134) had bumped `token_version`
 * on the database but the verify paths did not compare it, so the
 * bumps landed on a write-only column. Centralising the read+compare
 * in one place makes that class of bug impossible to introduce by
 * forgetting the comparison in a new issuer.
 *
 * Behaviour
 * ---------
 *   * `assertTokenVersionMatches(payload, dbRow)` returns true when
 *     the JWT's claim equals the row's current value. False on any
 *     mismatch (including missing claim, missing row value, or null
 *     row).
 *   * The function is pure: it does not query the database, it does
 *     not log, and it does not throw. Callers are expected to log on
 *     mismatch for audit and to take the action appropriate to their
 *     context (return null, clear cache, force re-auth).
 *   * The default value is 1 in both the JWT claim and the row. A
 *     legacy JWT minted before this fix has no claim; the comparison
 *     treats that as 1, so it continues to verify until its natural
 *     expiry OR until the row's value is bumped past 1 (e.g. logout).
 */

/**
 * Coerce a value to a positive integer, defaulting to 1.
 *
 * Accepts:
 *   * positive integer numbers (1, 2, 3, ...)
 *   * integer-typed strings ("3") — pg returns BIGINT as a string in
 *     some configurations, and a JSON-decoded JWT claim can be a
 *     number OR a string depending on the issuer
 *   * null / undefined / non-numeric / non-integer / zero / negative
 *     values — all coerce to 1
 */
function toVersion(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return 1;
}

/**
 * Return true if the JWT's `tokenVersion` claim matches the row's
 * current `token_version` value.
 *
 * @param jwtClaim  The raw value of the `tokenVersion` claim from the
 *                  decoded JWT payload. May be undefined for legacy
 *                  tokens minted before PCP-144.
 * @param dbValue   The current value of the row's `token_version`
 *                  column. May be null (treated as 1), number, or
 *                  string-encoded number from a query result.
 */
export function tokenVersionMatches(
  jwtClaim: unknown,
  dbValue: unknown,
): boolean {
  return toVersion(jwtClaim) === toVersion(dbValue);
}

/**
 * Compare convenience used by the three verify paths. The verify path
 * supplies the freshly-read row value; the JWT payload supplies the
 * claim at sign time. Returns true on match.
 *
 * Use this from the verify path:
 *
 *     if (!tokenVersionMatches(payload.tokenVersion, row.token_version)) {
 *       // SECURITY (PCP-144): bumped version means logout / password
 *       // rotation happened after this JWT was issued. Reject.
 *       return null;
 *     }
 */
export function assertTokenVersionMatches(
  jwtPayload: { tokenVersion?: unknown } | null | undefined,
  dbTokenVersion: unknown,
): boolean {
  if (!jwtPayload) return false;
  return tokenVersionMatches(jwtPayload.tokenVersion, dbTokenVersion);
}
