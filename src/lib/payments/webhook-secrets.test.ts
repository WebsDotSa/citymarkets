/**
 * Tests for src/lib/payments/webhook-secrets.ts
 *
 * P0-2 (security Phase 1, 2026-10-03): webhook secret rotation
 * with grace window.
 *
 * These tests cover the three execution paths the route handlers
 * depend on:
 *
 *   1. Env-var fallback: no DB rows for a provider, the helper
 *      accepts the legacy env-var secret.
 *   2. DB-backed rotation: one or more active rows exist; the helper
 *      accepts tokens matching any of their env-var values.
 *   3. Negative paths: missing token, wrong token, env-var unset for
 *      a row, DB outage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pool so tests can simulate the DB returning whatever
// rows they need (or throwing). The real pool is wired into a
// Postgres connection we don't want in unit tests.
const mockPoolQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { verifyWebhookToken } from "@/lib/payments/webhook-secrets";

describe("verifyWebhookToken — env-var fallback (no DB rows)", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    process.env.MOYASAR_WEBHOOK_SECRET = "primary-secret";
    process.env.TAMARA_WEBHOOK_TOKEN = "tamara-primary";
  });

  it("accepts the env-var secret for moyasar when DB has no rows", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const r = await verifyWebhookToken("moyasar", "primary-secret");
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(true);
    expect(r.matchedLabel).toBe("env-fallback");
  });

  it("accepts the env-var secret for tamara when DB has no rows", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const r = await verifyWebhookToken("tamara", "tamara-primary");
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(true);
  });

  it("rejects a wrong token when DB has no rows", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const r = await verifyWebhookToken("moyasar", "wrong-secret");
    expect(r.ok).toBe(false);
  });

  it("rejects an empty token", async () => {
    const r = await verifyWebhookToken("moyasar", "");
    expect(r.ok).toBe(false);
    expect(r.usedFallback).toBe(false);
  });
});

describe("verifyWebhookToken — DB-backed rotation", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    // Two env vars are set; the DB has rows pointing at both.
    process.env.MOYASAR_WEBHOOK_SECRET = "v1-secret";
    process.env.MOYASAR_WEBHOOK_SECRET_V2 = "v2-secret";
  });

  it("accepts a token matching the primary row", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { env_var_name: "MOYASAR_WEBHOOK_SECRET", label: "primary" },
        { env_var_name: "MOYASAR_WEBHOOK_SECRET_V2", label: "v2" },
      ],
    });
    const r = await verifyWebhookToken("moyasar", "v1-secret");
    expect(r.ok).toBe(true);
    expect(r.matchedLabel).toBe("primary");
    expect(r.usedFallback).toBe(false);
  });

  it("accepts a token matching a rotation row (grace period)", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { env_var_name: "MOYASAR_WEBHOOK_SECRET", label: "primary" },
        { env_var_name: "MOYASAR_WEBHOOK_SECRET_V2", label: "v2" },
      ],
    });
    const r = await verifyWebhookToken("moyasar", "v2-secret");
    expect(r.ok).toBe(true);
    expect(r.matchedLabel).toBe("v2");
    expect(r.usedFallback).toBe(false);
  });

  it("rejects a token that does not match any active row", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { env_var_name: "MOYASAR_WEBHOOK_SECRET", label: "primary" },
        { env_var_name: "MOYASAR_WEBHOOK_SECRET_V2", label: "v2" },
      ],
    });
    const r = await verifyWebhookToken("moyasar", "rogue-token");
    expect(r.ok).toBe(false);
  });

  it("skips a row whose env var is not set in the process", async () => {
    delete process.env.MOYASAR_WEBHOOK_SECRET_V2;
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { env_var_name: "MOYASAR_WEBHOOK_SECRET_V2", label: "v2" },
      ],
    });
    // The only row points at an unset env var. Even a "correct" token
    // for that env var cannot verify, so the helper returns false
    // rather than 500.
    const r = await verifyWebhookToken("moyasar", "v2-secret");
    expect(r.ok).toBe(false);
  });
});

describe("verifyWebhookToken — DB outage", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("degrades to env-var fallback when the DB query throws", async () => {
    process.env.MOYASAR_WEBHOOK_SECRET = "primary-secret";
    mockPoolQuery.mockRejectedValueOnce(new Error("connection refused"));
    const r = await verifyWebhookToken("moyasar", "primary-secret");
    // Helper should not throw. The env-var fallback should kick in.
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(true);
  });

  it("rejects when both DB and env are unavailable", async () => {
    delete process.env.MOYASAR_WEBHOOK_SECRET;
    mockPoolQuery.mockRejectedValueOnce(new Error("connection refused"));
    const r = await verifyWebhookToken("moyasar", "anything");
    expect(r.ok).toBe(false);
    expect(r.usedFallback).toBe(false);
  });
});
