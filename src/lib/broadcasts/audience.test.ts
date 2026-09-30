import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

const queryMock = vi.fn();
const client = { query: queryMock } as unknown as PoolClient;

vi.mock("@/lib/db", () => ({ pool: {} }));

import { expandBroadcastAudience } from "./audience";

describe("audience.ts", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("inserts one row per (user, channel) with ON CONFLICT DO NOTHING", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { channel: "email" },
        { channel: "email" },
        { channel: "sms" },
      ],
      rowCount: 3,
    });
    const r = await expandBroadcastAudience(
      client,
      "b-1",
      { type: "all" },
      ["email", "sms"],
    );
    expect(r.inserted).toBe(3);
    expect(r.byChannel).toEqual({ web_push: 0, native_push: 0, sms: 1, email: 2, in_app: 0 });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/WITH user_ids AS/);
    expect(sql).toMatch(/CROSS JOIN UNNEST/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params).toEqual(["b-1", ["email", "sms"]]);
  });

  it("expands `with_phone` segment to phone-only filter", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(client, "b-2", { type: "segment", segment: "with_phone" }, ["sms"]);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/phone IS NOT NULL AND phone <> ''/);
  });

  it("expands `with_email` segment with a regex check", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(
      client,
      "b-3",
      { type: "segment", segment: "with_email" },
      ["email"],
    );
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/email IS NOT NULL/);
    expect(sql).toMatch(/\^[^@]+@/);
  });

  it("expands `top_loyalty` with PERCENTILE_CONT 90th", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(
      client,
      "b-4",
      { type: "segment", segment: "top_loyalty" },
      ["email"],
    );
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/PERCENTILE_CONT\(0\.9\)/);
  });

  it("expands `ordered_last_30d` with 30-day window", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(
      client,
      "b-5",
      { type: "segment", segment: "ordered_last_30d" },
      ["in_app"],
    );
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INTERVAL '30 days'/);
  });

  it("expands `inactive_30d` with NOT IN", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(
      client,
      "b-6",
      { type: "segment", segment: "inactive_30d" },
      ["in_app"],
    );
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/id NOT IN/);
  });

  it("applies loyalty_min, loyalty_tier, city, and exclude_user_ids together", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expandBroadcastAudience(
      client,
      "b-7",
      {
        type: "all",
        loyalty_min: 50,
        loyalty_tier: "gold",
        city: "الرياض",
        exclude_user_ids: ["u-9", "u-10"],
      },
      ["email"],
    );
    const [sql, params] = queryMock.mock.calls[0];
    // P1-3 (full-system audit 2026-09-30): the legacy
    // `users.loyalty_points` column is no longer written; the live
    // balance lives in the `loyalty_points` table. Assert the new
    // EXISTS(SELECT 1 FROM loyalty_points …) shape instead.
    expect(sql).toMatch(/loyalty_points[\s\S]+balance >= \$1/);
    expect(sql).toMatch(/loyalty_tier = \$2::loyalty_tier_enum/);
    expect(sql).toMatch(/SELECT user_id FROM addresses WHERE city = \$3/);
    expect(sql).toMatch(/id <> ALL\(\$4::uuid\[\]\)/);
    expect(params).toEqual([50, "gold", "الرياض", ["u-9", "u-10"], "b-7", ["email"]]);
  });
});
