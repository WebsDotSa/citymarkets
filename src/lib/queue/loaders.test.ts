/**
 * Regression test for `src/lib/queue/loaders.ts`.
 *
 * Contract (audit 2026-10-04 — refactor/full-repository-consolidation):
 *   - enqueue.ts and workers.ts MUST both consume loaders from this file
 *     instead of re-implementing the SELECTs inline. The worker especially
 *     is a hot path that runs against the production DB every minute and
 *     historically drifted from the enqueue path's payload shape.
 *
 * This test enforces the contract by parsing the source of both modules
 * and asserting that:
 *   1. They import the loaders from `./loaders`.
 *   2. They do NOT contain verbatim copies of the canonical SELECT
 *      fragments (would mean an inline re-implementation snuck back in).
 *
 * It does NOT exercise the DB (the loaders are pure DB read; integration
 * coverage lives in `queue.test.ts`).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..", "..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(REPO, relPath), "utf-8");
}

describe("queue loaders contract (refactor/full-repository-consolidation)", () => {
  it("enqueue.ts imports both loaders from ./loaders", () => {
    const src = readSrc("src/lib/queue/enqueue.ts");
    expect(src).toMatch(/from\s+["']\.\/loaders["']/);
    expect(src).toMatch(/loadOrderForNotification/);
    expect(src).toMatch(/loadPaidSmsArgs/);
  });

  it("workers.ts imports both loaders from ./loaders", () => {
    const src = readSrc("src/lib/queue/workers.ts");
    expect(src).toMatch(/from\s+["']\.\/loaders["']/);
    expect(src).toMatch(/loadOrderForNotification/);
    expect(src).toMatch(/loadPaidSmsArgs/);
  });

  it("enqueue.ts does NOT re-inline the canonical order SELECT", () => {
    // The canonical fragment in loaders.ts pulls `o.id, o.total, o.guest_name,
    // u.name AS customer_name`. If we see the same SELECT in enqueue.ts (or
    // workers.ts) outside of a string passed to a non-loaders helper, the
    // contract has been violated.
    const src = readSrc("src/lib/queue/enqueue.ts");
    expect(src).not.toMatch(/SELECT\s+o\.id,\s*o\.total,\s*o\.guest_name/);
  });

  it("workers.ts does NOT re-inline the canonical order SELECT", () => {
    const src = readSrc("src/lib/queue/workers.ts");
    expect(src).not.toMatch(/SELECT\s+o\.id,\s*o\.total,\s*o\.guest_name/);
  });

  it("loaders.ts exports the three documented loaders", async () => {
    const mod = await import("./loaders");
    expect(typeof mod.loadOrderForNotification).toBe("function");
    expect(typeof mod.loadPaidSmsArgs).toBe("function");
    expect(typeof mod.loadOrderVendorIds).toBe("function");
  });
});