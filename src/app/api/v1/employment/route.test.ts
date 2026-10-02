import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/v1/employment (public submission).
 *
 * The endpoint must:
 *  - accept a CV that was previously uploaded via /api/v1/upload/cv
 *  - validate required fields (full_name, phone, job_id, cv_url)
 *  - reject malformed phone numbers
 *  - reject unknown job_id values
 *  - reject email addresses that don't look like emails
 *  - reject CVs whose URL is not under /images/employment/
 *
 * We mock `@/lib/db` so we can assert against the inserted row and
 * verify the route's defensive validation.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockThrow) throw new Error("DB down");
    return { rows: [{ id: "app-1", created_at: "2026-08-01T00:00:00Z" }] };
  }),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

// SECURITY (PCP-133): mock the rate limiter so the test doesn't
// share buckets across runs. checkRateLimit always allows.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100, resetMs: 0 })),
  EMPLOYMENT_APPLY_IP_CONFIG: {},
  EMPLOYMENT_APPLY_PHONE_CONFIG: {},
  createRateLimitHeaders: vi.fn(),
}));
vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { query } from "@/lib/db";
import { POST } from "./route";

const validBody = {
  full_name: "محمد أحمد",
  phone: "+966530444976",
  email: "mohammad@example.com",
  job_id: "delivery",
  message: "خبرة 3 سنوات في التوصيل",
  cv_url: "/images/employment/cv_123.pdf",
  cv_filename: "cv_123.pdf",
  cv_size_bytes: 12345,
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/employment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/employment — public submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockThrow = false;
  });

  it("inserts the application and returns its id", async () => {
    const res = await POST(makeRequest(validBody) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("app-1");

    const insert = calls.find((c) => /^INSERT INTO job_applications/i.test(c.sql.trim()));
    expect(insert).toBeDefined();
    // The Arabic job title must be resolved from job_id before insert
    expect(insert!.params[3]).toBe("delivery");
    expect(insert!.params[4]).toBe("سائق توصيل");
  });

  it("rejects submissions missing the CV URL", async () => {
    const res = await POST(makeRequest({ ...validBody, cv_url: "" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/السيرة الذاتية/);
  });

  it("rejects CV URLs outside the /images/employment/ allowlist (path traversal)", async () => {
    const res = await POST(
      makeRequest({ ...validBody, cv_url: "/etc/passwd" }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects unknown job_id values", async () => {
    const res = await POST(
      makeRequest({ ...validBody, job_id: "ceo-of-the-universe" }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/غير صالحة/);
  });

  it("rejects phone numbers that don't match the Saudi format", async () => {
    const res = await POST(
      makeRequest({ ...validBody, phone: "abc-not-a-phone" }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/الجوال/);
  });

  it("rejects malformed email addresses", async () => {
    const res = await POST(
      makeRequest({ ...validBody, email: "not-an-email" }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("allows email to be omitted entirely", async () => {
    const { email, ...rest } = validBody;
    const res = await POST(makeRequest(rest) as never);
    expect(res.status).toBe(200);
  });

  it("returns 500 and a generic Arabic error if the DB throws", async () => {
    (query as any).mockThrow = true;
    const res = await POST(makeRequest(validBody) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/فشل/);
  });
});
