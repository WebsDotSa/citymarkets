/**
 * Tests for src/lib/errors/checkout-error-reporter.ts.
 *
 * The reporter is best-effort: it must NEVER throw, regardless of input
 * shape or environment. These tests guard that contract so a future
 * refactor can't accidentally break the user-facing checkout response
 * by adding a throw inside the reporter.
 *
 * Strategy: call `reportCheckoutError` with a variety of malformed /
 * surprising inputs and assert it resolves (does not throw). The Sentry
 * + file-dump side-effects are observed via spies on `@sentry/nextjs`
 * and `node:fs/promises`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

import * as Sentry from "@sentry/nextjs";
import * as fsp from "node:fs/promises";
import { reportCheckoutError } from "@/lib/errors/checkout-error-reporter";

describe("reportCheckoutError — best-effort contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CHECKOUT_ERROR_LOG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw on a plain Error", async () => {
    await expect(
      reportCheckoutError(new Error("boom"), {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: "u-1",
      }),
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("does not throw on a string (non-Error) error", async () => {
    await expect(
      reportCheckoutError("just a string", {
        surface: "orders",
        route: "POST /api/v1/orders",
        userId: null,
      }),
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("does not throw on null / undefined", async () => {
    await expect(
      reportCheckoutError(null, {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: null,
      }),
    ).resolves.toBeUndefined();
    await expect(
      reportCheckoutError(undefined, {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw on a circular structure", async () => {
    const circ: Record<string, unknown> = { name: "circ" };
    circ.self = circ;
    await expect(
      reportCheckoutError(circ, {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("unwraps pg-shaped .cause and surfaces pgCode as a Sentry tag", async () => {
    const pgErr = Object.assign(new Error("duplicate key"), {
      code: "23505",
      cause: new Error("inner"),
    });
    await reportCheckoutError(pgErr, {
      surface: "checkout",
      route: "POST /api/v1/checkout",
      userId: "u-2",
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = vi.mocked(Sentry.captureException).mock.calls[0];
    const ctx = call?.[1] as { tags?: Record<string, string> } | undefined;
    expect(ctx?.tags).toMatchObject({ pgCode: "23505", surface: "checkout" });
  });

  it("swallows Sentry failures and still writes the file dump", async () => {
    vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
      throw new Error("sentry down");
    });
    await expect(
      reportCheckoutError(new Error("x"), {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: "u-3",
      }),
    ).resolves.toBeUndefined();
    // File dump still ran.
    expect(fsp.appendFile).toHaveBeenCalledTimes(1);
  });

  it("swallows file dump failures", async () => {
    vi.mocked(fsp.appendFile).mockRejectedValueOnce(new Error("ENOSPC"));
    await expect(
      reportCheckoutError(new Error("x"), {
        surface: "checkout",
        route: "POST /api/v1/checkout",
        userId: "u-4",
      }),
    ).resolves.toBeUndefined();
    // Sentry still ran.
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("honours CHECKOUT_ERROR_LOG override for the dump path", async () => {
    process.env.CHECKOUT_ERROR_LOG = "/var/log/citymarket/override.log";
    await reportCheckoutError(new Error("x"), {
      surface: "checkout",
      route: "POST /api/v1/checkout",
      userId: "u-5",
    });
    const call = vi.mocked(fsp.appendFile).mock.calls[0];
    expect(call?.[0]).toBe("/var/log/citymarket/override.log");
  });
});
