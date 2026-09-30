/**
 * Shared error reporter for checkout + orders routes.
 *
 * Why this exists
 * ---------------
 * The catch-all paths in `src/app/api/v1/checkout/route.ts` and
 * `src/app/api/v1/orders/route.ts` swallow the real cause behind a generic
 * Arabic error message so production responses never leak pg constraint
 * codes. To keep operators able to triage, each route duplicates the same
 * ~30-line "side-channel dump" block that writes a JSON line to
 * `<cwd>/logs/checkout-errors.log` (or `process.env.CHECKOUT_ERROR_LOG`
 * when overridden).
 *
 * The duplication is a hazard: any change to the shape of the dump has
 * to be applied in two places, and we've already seen the two diverge
 * subtly (one truncates stack to 8 lines, the other doesn't). Centralising
 * the reporter here means:
 *
 *   1. Single source of truth for what gets captured.
 *   2. Sentry capture added alongside the file dump so on-call gets
 *      structured, searchable, deduplicated events. Sentry is a no-op
 *      when `SENTRY_DSN` is unset, so dev / staging / local runs are
 *      unaffected.
 *   3. File dump remains as the last-resort fallback for hosts where
 *      Sentry isn't configured (e.g. an air-gapped staging box).
 *
 * Best-effort contract
 * --------------------
 * This module NEVER throws. Errors during Sentry capture or filesystem
 * write are swallowed inside each helper so the user-facing HTTP response
 * is never broken by a logging regression. If you need to debug the
 * reporter itself, check `process.stderr` — we write to `console.error`
 * from the catch blocks but don't propagate.
 */

import * as Sentry from "@sentry/nextjs";
import { error as logError } from "@/lib/logger";

export interface CheckoutErrorContext {
  /** End-user id (best-effort; may be null when the request failed auth). */
  userId: string | null;
  /** Idempotency key from the request body, if present. */
  idempotencyKey?: string | null;
  /** Number of cart items in the request. */
  itemsCount?: number;
  /** Number of vendor groups the cart split into. */
  vendorGroupsCount?: number;
  /** Resolved payment method from the request body. */
  paymentMethod?: string | null;
  /** "delivery" or "pickup" — affects which code path was active. */
  deliveryType?: string | null;
  /** Whether this error came from /checkout or /orders. */
  surface: "checkout" | "orders";
  /** The route that produced the error. */
  route: string;
}

/**
 * Report an error from the checkout / orders catch-all. Sends to Sentry
 * (if configured) and appends a JSON line to the on-disk dump file.
 *
 * Order of operations:
 *   1. Capture in Sentry with rich tags + extra context. Errors here are
 *      swallowed.
 *   2. Append a JSON line to CHECKOUT_ERROR_LOG / <cwd>/logs / <tmpdir>.
 *      Errors here are also swallowed.
 *
 * Why the file dump is kept: it predates Sentry, has been used to triage
 * production incidents, and remains useful in environments where Sentry
 * is not configured (e.g. on-prem / air-gapped).
 */
export async function reportCheckoutError(
  error: unknown,
  context: CheckoutErrorContext,
): Promise<void> {
  const cause = unwrapPgCause(error);
  const causeMsg =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message: unknown }).message)
      : null;
  const pgCode =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code: unknown }).code)
      : null;

  const tags: Record<string, string> = {
    surface: context.surface,
    route: context.route,
  };
  if (context.paymentMethod) tags.paymentMethod = context.paymentMethod;
  if (context.deliveryType) tags.deliveryType = context.deliveryType;
  if (pgCode) tags.pgCode = pgCode;

  const extra: Record<string, unknown> = {
    userId: context.userId ?? null,
    idempotencyKey: context.idempotencyKey ?? null,
    itemsCount: context.itemsCount ?? 0,
    vendorGroupsCount: context.vendorGroupsCount ?? 0,
    pgCode,
    pgMessage: causeMsg,
  };

  // 1. Sentry — structured capture. Sentry.init() is a no-op when DSN
  //    is unset, so this is safe in dev / CI / local.
  try {
    Sentry.captureException(error, {
      tags,
      extra,
    });
  } catch (sentryErr) {
    // Sentry failures must never bubble. Log via canonical logger
    // (audit I39) so the prod-vs-dev LOG_LEVEL split applies.
    logError("[checkout-error-reporter] Sentry capture failed", sentryErr);
  }

  // 2. File dump — same JSON shape the existing inline blocks produced,
  //    so on-call tooling that grep-parses the file continues to work.
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dumpPath = resolveDumpPath();
    await fs.mkdir(path.dirname(dumpPath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...extra,
      paymentMethod: context.paymentMethod ?? null,
      deliveryType: context.deliveryType ?? null,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      // Keep the full stack at WARN level — useful when the same
      // error recurs and we need to find the offending line.
      stack:
        error instanceof Error
          ? (error.stack ?? "").split("\n").slice(0, 8).join("\n")
          : null,
    });
    await fs.appendFile(dumpPath, line + "\n", "utf8");
  } catch (fsErr) {
    // Same best-effort contract as the previous inline blocks.
    // Audit I39: canonical logger.
    logError("[checkout-error-reporter] file dump failed", fsErr);
  }
}

/**
 * Resolve where the file dump should land. Priority:
 *   1. `process.env.CHECKOUT_ERROR_LOG` — operator bind-mount override.
 *   2. `<tmpdir>/checkout-errors.log` — always writable in Docker
 *      containers (docker-compose mounts tmpfs at /tmp) so on-call
 *      can `docker exec ... cat /tmp/checkout-errors.log` without
 *      restarting anything.
 *
 * We deliberately skip the old `<cwd>/logs/checkout-errors.log` fallback
 * because the production container runs with `read_only: true` and a
 * non-root user — `<cwd>/logs` is not writable. `<tmpdir>` is.
 */
function resolveDumpPath(): string {
  if (process.env.CHECKOUT_ERROR_LOG) {
    return process.env.CHECKOUT_ERROR_LOG;
  }
  // Lazy require to avoid loading path at module init in environments
  // that don't exercise this code path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  return path.join(os.tmpdir(), "checkout-errors.log");
}

/**
 * pg errors are usually nested — the user-facing error is a wrapper and
 * the real cause is on `.cause` (since Node 16.9). Drill down until we
 * find something with a `code` field that looks like a pg SQLSTATE.
 */
function unwrapPgCause(error: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (!error || typeof error !== "object") return error;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return candidate;
  }
  if (candidate.cause) return unwrapPgCause(candidate.cause, depth + 1);
  return error;
}
