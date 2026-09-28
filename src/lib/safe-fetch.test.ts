import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { safeFetchJson, safeFetchJsonStrict, HttpError } from "./safe-fetch";

describe("safeFetchJson", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [1, 2, 3] }),
      }))
    );
    const res = await safeFetchJson<{ success: boolean; data: number[] }>(
      "/api/test"
    );
    expect(res?.success).toBe(true);
    expect(res?.data).toEqual([1, 2, 3]);
  });

  it("returns null without logging when aborted before fetch", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await safeFetchJson("/api/test", { signal: ac.signal });
    expect(res).toBeNull();
  });

  it("returns null when JSON parse fails on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }))
    );
    const res = await safeFetchJson("/api/test");
    expect(res).toBeNull();
  });

  it("returns parsed body on non-2xx (preserves existing caller contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: "boom" }),
      }))
    );
    const res = await safeFetchJson<{ success: boolean; error: string }>(
      "/api/test"
    );
    expect(res?.success).toBe(false);
    expect(res?.error).toBe("boom");
  });
});

describe("safeFetchJsonStrict", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns ok=true with parsed body on 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ items: [1, 2] }),
      }))
    );
    const res = await safeFetchJsonStrict<{ items: number[] }>("/api/test");
    expect(res?.ok).toBe(true);
    if (res?.ok) {
      expect(res.status).toBe(200);
      expect(res.data.items).toEqual([1, 2]);
    }
  });

  it("returns ok=false with status and body on 4xx/5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "not found" }),
      }))
    );
    const res = await safeFetchJsonStrict("/api/test");
    expect(res?.ok).toBe(false);
    if (res && !res.ok) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not found" });
    }
  });

  it("returns null when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await safeFetchJsonStrict("/api/test", { signal: ac.signal });
    expect(res).toBeNull();
  });

  it("returns null on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("NetworkError");
      })
    );
    const res = await safeFetchJsonStrict("/api/test");
    expect(res).toBeNull();
  });
});

describe("HttpError", () => {
  it("preserves status and body", () => {
    const err = new HttpError(403, { reason: "forbidden" });
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ reason: "forbidden" });
    expect(err.name).toBe("HttpError");
    expect(err.message).toBe("HTTP 403");
  });

  it("accepts a custom message", () => {
    const err = new HttpError(401, null, "Unauthorized");
    expect(err.message).toBe("Unauthorized");
  });
});
