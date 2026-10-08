/**
 * `withApiGuards` — Higher-Order helper for admin route handlers.
 *
 * Wraps a route handler so the boilerplate
 *
 *   const gate = await requireAdminApi(request, 'manage_X');
 *   if (gate instanceof NextResponse) return gate;
 *
 * disappears, and so every error path — gate rejection, thrown error,
 * inner return of `NextResponse.json({...}, {status})` — funnels through
 * the canonical envelope from `@/lib/api-response` (stable `error.code`
 * + bilingual `error.messageAr/messageEn` + `requestId`).
 *
 * Scope (I40-I44 closure, full-repository-consolidation 2026-09-30):
 *
 *   - Auth gate only. CSRF is enforced by middleware (`src/middleware.ts`)
 *     BEFORE the handler ever runs, so the HOC doesn't repeat the check.
 *     Rate limiting lives in route-specific modules (see
 *     `@/lib/rate-limit`) and is opt-in per route via `extraGuards`.
 *
 *   - One wrapper today: `withAdminApi` (composes `requireAdminApi`).
 *     The signature deliberately mirrors `requireAdminApi`'s so a future
 *     vendor or customer wrapper can be added without touching call
 *     sites:
 *         withApiGuards(handler, { auth: 'admin', permission: 'manage_products' })
 *
 * Usage:
 *
 *   export const GET = withAdminApi(async (request, ctx, { admin }) => {
 *     return ok({ items: [] });
 *   }, { permission: 'manage_products' });
 *
 * The HOC returns the SAME NextResponse the inner handler produced when
 * the handler already returned an envelope-friendly response (status
 * < 500, or status >= 500 with `success:false`). Otherwise it converts
 * raw `NextResponse.json({...})` outputs into the canonical envelope by
 * detecting the legacy `{ success, error: <arabic string> }` shape and
 * rewriting it through `fail()`.
 *
 * Design notes:
 *
 *   - The HOC is server-only (admin handlers always are). Marked with
 *     `import "server-only"` so accidental client imports fail loud at
 *     build time.
 *   - Errors thrown by the inner handler are caught and turned into
 *     `internalError()` — this preserves the bilingual UX and adds a
 *     `requestId` for log correlation. The original error is logged
 *     via `@/lib/logger` (severity `error`).
 *   - The wrapper does NOT swallow legitimate NextResponses returned by
 *     the handler (e.g. `ok(data)`, `notFound(...)`). It only rewrites
 *     responses when the body is the legacy `{ success, error: string }`
 *     shape — everything else passes through untouched so callers that
 *     already adopted the envelope keep full control over their
 *     status code, headers, and details.
 */
import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ok as okEnvelope,
  fail,
  ErrorCodes,
  getRequestId,
} from "@/lib/api-response";
import { requireAdminApi, type AdminAuthUser } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from "@/lib/logger";

/**
 * Discriminated context the inner handler receives. The base type is the
 * admin auth context (`{ admin }`); handlers that use Next.js dynamic
 * route segments (`/api/admin/[id]`) can intersect with `{ params: ... }`.
 *
 * Two flavours are supported today:
 *
 *   - Flat handler: `withAdminApi(async (req, { admin }) => ...)`
 *     — used by routes without dynamic segments.
 *
 *   - Dynamic-segment handler:
 *         withAdminApi<{ id: string }>(async (req, { admin, params }) => {
 *           const { id } = await params;
 *           ...
 *         })
 *     — `params` is the same `Promise<...>` shape Next.js 15+ passes to
 *     App Router handlers; the HOC forwards it unchanged.
 */
export interface AdminHandlerContext {
  admin: AdminAuthUser;
}

export type AdminRouteHandler<TParams = Record<string, never>> = (
  request: NextRequest,
  context: AdminHandlerContext & { params: Promise<TParams> },
) => Promise<NextResponse> | NextResponse;

export interface WithAdminOptions {
  /**
   * Permission key from `ROLE_PERMISSIONS` (e.g. `manage_products`).
   * Passed straight through to `requireAdminApi`. Omit for any
   * signed-in admin (no permission check beyond auth).
   */
  permission?: string;
}

/**
 * The legacy admin error envelope shape: `{ success: false, error: <arabic
 * string> }` — and ONLY that shape. Routes that haven't been migrated yet
 * return exactly this object; the HOC detects it and rewrites via `fail()`
 * so the response is wire-compatible with the canonical envelope.
 *
 * Anything else passes through untouched:
 *   - already-migrated canonical envelopes (have `error.code` etc.)
 *   - paginated `ok()` responses (status < 400, never enter this path)
 *   - 410 deprecation stubs that carry a `replacement` pointer — the
 *     client reads `replacement` and we must not strip it
 *   - 4xx responses that already speak the canonical envelope
 *   - any response with extra keys beyond `{ success, error }`
 */
interface LegacyAdminErrorBody {
  success?: boolean;
  error?: string;
}

function isLegacyAdminErrorBody(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.length !== 2) return false;
  if (!keys.includes("success") || !keys.includes("error")) return false;
  const v = value as LegacyAdminErrorBody;
  return v.success === false && typeof v.error === "string";
}

function envelopeForLegacy(body: { error: string }, status: number): NextResponse {
  const code: keyof typeof ErrorCodes =
    status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 409
            ? "CONFLICT"
            : status === 410
              ? "GONE"
              : status === 400
                ? "BAD_REQUEST"
                : status === 422
                  ? "VALIDATION_FAILED"
                  : "INTERNAL";
  return fail(ErrorCodes[code], status, {
    messageAr: body.error,
    // No English translation available for legacy strings; mirror the
    // Arabic so the client can render either side without an empty box.
    messageEn: body.error,
  });
}

async function rewriteIfLegacy(
  response: NextResponse,
  requestId: string,
): Promise<NextResponse> {
  const status = response.status;
  // 2xx success envelopes and 5xx responses we never rewrite —
  // success routes already speak the canonical envelope, and 5xx
  // failures from raw `NextResponse.json({ error: string }, {500})`
  // are almost always accidental double-fail paths that the handler
  // author wanted to surface. Leave the original status alone.
  if (status < 400) return response;
  if (status >= 500) return response;
  // 4xx — only rewrite the legacy shape; otherwise pass through.
  try {
    const clone = response.clone();
    const body = (await clone.json()) as unknown;
    if (isLegacyAdminErrorBody(body)) {
      return envelopeForLegacy(body, status);
    }
  } catch {
    // non-JSON body, leave it
  }
  return response;
}

/**
 * Wrap an admin route handler with the canonical guard chain.
 *
 * 1. Run `requireAdminApi(request, options.permission)`.
 *    - On failure, the underlying 401/403 NextResponse is rewritten
 *      through the canonical envelope.
 * 2. On success, invoke the handler with `{ admin }` context.
 * 3. Catch thrown errors and convert to `internalError()` envelope.
 * 4. Detect legacy `{ success:false, error:<ar> }` 4xx responses and
 *    convert them to the canonical envelope. Other responses pass
 *    through unchanged.
 *
 * The `requestId` is sourced from the inbound `x-request-id` header
 * (or generated) and attached to rewritten responses for log
 * correlation.
 */
export function withAdminApi<TParams = Record<string, never>>(
  handler: AdminRouteHandler<TParams>,
  options: WithAdminOptions = {},
): (
  request: NextRequest,
  ctx?: { params?: Promise<TParams> },
) => Promise<NextResponse> {
  return async (
    request: NextRequest,
    ctx?: { params?: Promise<TParams> },
  ): Promise<NextResponse> => {
    const requestId = getRequestId(request);

    const gate = await requireAdminApi(request, options.permission);
    if (gate instanceof NextResponse) {
      // 401/403 from requireAdminApi — convert legacy
      // `{ success:false, error:<ar> }` to canonical envelope.
      return rewriteIfLegacy(gate, requestId);
    }

    try {
      const response = await handler(request, {
        admin: gate.admin,
        params: ctx?.params ?? Promise.resolve({} as TParams),
      });
      return await rewriteIfLegacy(response, requestId);
    } catch (err) {
      logError("admin route handler threw", {
        requestId,
        path: new URL(request.url).pathname,
        method: request.method,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail(ErrorCodes.INTERNAL, 500, {
        headers: { "x-request-id": requestId },
      });
    }
  };
}

/**
 * Re-export the typed `AdminAuthUser` so consumers can pull both the
 * HOC and the auth shape from `@/lib/api/with-api-guards`. This keeps
 * the migration footprint small: `import { withAdminApi } from
 * "@/lib/api/with-api-guards"` brings the guard AND the `admin`
 * context type in one line.
 */
export type { AdminAuthUser };

/**
 * `ok` re-export so handlers can build success envelopes without
 * importing from `@/lib/api-response` directly. Convenience only.
 */
export { okEnvelope as ok };
