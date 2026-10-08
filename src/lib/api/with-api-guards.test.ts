/**
 * Tests for `withAdminApi` — the admin route HOC.
 *
 * Three contracts are guarded here:
 *
 *   1. Auth rejection is rewritten through the canonical envelope.
 *      A 401 from `requireAdminApi` (no admin session) must surface as
 *      `{ success:false, error:{ code:"UNAUTHORIZED", ... }, requestId }`
 *      — not the legacy `{ success:false, error:"يجب تسجيل الدخول" }`
 *      shape the underlying gate returns.
 *
 *   2. Thrown errors are caught and converted to `internalError()`
 *      (HTTP 500, code INTERNAL) so the wire shape is stable even when
 *      the handler author forgot to catch something.
 *
 *   3. A handler that returns the legacy `{ success:false,
 *      error:"..." }` shape inside a 4xx status is rewritten to the
 *      canonical envelope. 2xx and 5xx responses pass through untouched
 *      (success routes already speak the canonical envelope, and a
 *      handler that intentionally returns 5xx is not something we want
 *      to silently rewrite).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import {
  withAdminApi,
  ok,
} from "@/lib/api/with-api-guards";
import { ErrorCodes } from "@/lib/api-response";

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

const fakeAdmin = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "ops@example.com",
  role: "super_admin" as const,
  tokenVersion: 1,
};

vi.mock("@/lib/identity/admin-api-auth-db", () => ({
  requireAdminApi: vi.fn(),
}));

import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/test", {
    method: "GET",
    headers: { "x-request-id": "test-req-id-001", ...headers },
  });
}

function makeRouteCtx<TParams = Record<string, never>>(
  params: TParams = {} as TParams,
): { params: Promise<TParams> } {
  return { params: Promise.resolve(params) };
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.mocked(requireAdminApi).mockReset();
});

describe("withAdminApi — auth gate rewriting", () => {
  it("rewrites a 401 from requireAdminApi into the canonical envelope", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue(
      NextResponse.json(
        { success: false, error: "يجب تسجيل الدخول" },
        { status: 401 },
      ),
    );
    const handler = withAdminApi(async () => ok({ items: [] }));
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(401);
    const body = await readJson<{
      success: boolean;
      error: { code: string; messageAr: string };
      requestId: string;
    }>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(body.error.messageAr).toContain("تسجيل الدخول");
    expect(typeof body.requestId).toBe("string");
  });

  it("rewrites a 403 from requireAdminApi into FORBIDDEN code", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue(
      NextResponse.json(
        { success: false, error: "ليست لديك صلاحية لهذا الإجراء" },
        { status: 403 },
      ),
    );
    const handler = withAdminApi(async () => ok({ items: [] }));
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(403);
    const body = await readJson<{
      success: boolean;
      error: { code: string };
    }>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });
});

describe("withAdminApi — handler invocation", () => {
  it("invokes the handler when requireAdminApi returns an admin", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const seenAdmin: string[] = [];
    const handler = withAdminApi(async (_req, ctx) => {
      seenAdmin.push(ctx.admin.id);
      return ok({ ok: true });
    });
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(seenAdmin).toEqual([fakeAdmin.id]);
    expect(res.status).toBe(200);
    const body = await readJson<{ success: boolean; data: { ok: boolean } }>(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
  });

  it("forwards the permission key to requireAdminApi", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi(async () => ok(null), {
      permission: "manage_products",
    });
    await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(requireAdminApi).toHaveBeenCalledWith(
      expect.anything(),
      "manage_products",
    );
  });

  it("forwards dynamic-route params to the handler via context.params", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi<{ id: string }>(async (_req, { params }) => {
      const { id } = await params;
      return ok({ id });
    });
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx({ id: "abc-123" }) as unknown as Parameters<typeof handler>[1],
    );
    const body = await readJson<{ success: boolean; data: { id: string } }>(res);
    expect(body.data.id).toBe("abc-123");
  });
});

describe("withAdminApi — error & response rewriting", () => {
  it("catches thrown errors and converts to INTERNAL/500 envelope", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi(async () => {
      throw new Error("db pool exhausted");
    });
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(500);
    const body = await readJson<{
      success: boolean;
      error: { code: string };
    }>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCodes.INTERNAL);
  });

  it("rewrites a legacy 4xx `{ success:false, error:\"...\" }` to canonical envelope", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi(async () =>
      NextResponse.json(
        { success: false, error: "الفئة غير موجودة" },
        { status: 404 },
      ),
    );
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(404);
    const body = await readJson<{
      success: boolean;
      error: { code: string; messageAr: string };
    }>(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(body.error.messageAr).toBe("الفئة غير موجودة");
  });

  it("leaves a 409 legacy body on CONFLICT", async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi(async () =>
      NextResponse.json(
        {
          success: false,
          error:
            "لا يمكن الحذف: هناك منتجات مرتبطة بهذه الفئة. انقل المنتجات لقسم آخر أو اختر حذف القسم مع منتجاته.",
        },
        { status: 409 },
      ),
    );
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(409);
    const body = await readJson<{
      success: boolean;
      error: { code: string };
    }>(res);
    expect(body.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it("passes through a 410 deprecation stub unchanged", async () => {
    // Legacy 410 deprecation stubs (e.g. /api/v1/orders POST) carry a
    // `replacement` field the client reads; we must not strip those.
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: fakeAdmin });
    const handler = withAdminApi(async () =>
      NextResponse.json(
        {
          success: false,
          error: "deprecated",
          message: "POST /api/v1/orders moved to POST /api/v1/checkout",
          replacement: "/api/v1/checkout",
        },
        { status: 410 },
      ),
    );
    const res = await handler(
      makeRequest() as unknown as Parameters<typeof handler>[0],
      makeRouteCtx() as unknown as Parameters<typeof handler>[1],
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { replacement: string };
    expect(body.replacement).toBe("/api/v1/checkout");
  });
});
