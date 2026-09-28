import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The gate does its single SELECT via a `PoolClient` (so the route can
 * share its checkout transaction). Tests stub `client.query` via a
 * `vi.fn()` and assert the parsed result.
 */
type Row = {
  id: string;
  name: string | null;
  slug: string | null;
  open_time: string;
  close_time: string;
  is_active: boolean;
};

function makeClient(rows: Row[]) {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  } as unknown as import("pg").PoolClient;
}

beforeEach(() => {
  vi.resetModules();
});

async function loadGate() {
  const mod = await import("./vendor-closed-gate");
  return mod.checkClosedVendorsInCart;
}

describe("checkClosedVendorsInCart", () => {
  it("returns empty when the cart has no vendor groups (catalog-only)", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([]);
    const result = await checkClosedVendorsInCart({ client, vendorIds: [] });
    expect(result.closed).toEqual([]);
    expect(result.message).toBe("");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns the only open vendor (no blocked list)", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([
      {
        id: "v1",
        name: "Open Co",
        slug: "open",
        open_time: "00:00",
        close_time: "23:59",
        is_active: true,
      },
    ]);
    const result = await checkClosedVendorsInCart({
      client,
      vendorIds: ["v1"],
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    expect(result.closed).toEqual([]);
    expect(result.message).toBe("");
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("flags a closed vendor (admin kill-switch)", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([
      {
        id: "v1",
        name: "Closed Co",
        slug: "closed",
        open_time: "00:00",
        close_time: "23:59",
        is_active: false,
      },
    ]);
    const result = await checkClosedVendorsInCart({
      client,
      vendorIds: ["v1"],
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({ id: "v1", name: "Closed Co" });
    expect(result.message).toContain("Closed Co");
  });

  it("flags a vendor outside its time window", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([
      {
        id: "v1",
        name: "Daytime Co",
        slug: "daytime",
        open_time: "09:00",
        close_time: "17:00",
        is_active: true,
      },
    ]);
    // 22:00 Riyadh = 19:00 UTC → after 17:00 close → closed.
    const result = await checkClosedVendorsInCart({
      client,
      vendorIds: ["v1"],
      now: new Date("2026-06-15T19:00:00.000Z"),
    });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].name).toBe("Daytime Co");
  });

  it("dedupes duplicate vendor ids in the request", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([
      {
        id: "v1",
        name: "Co",
        slug: "co",
        open_time: "09:00",
        close_time: "17:00",
        is_active: true,
      },
    ]);
    const result = await checkClosedVendorsInCart({
      client,
      vendorIds: ["v1", "v1", "v1"],
      now: new Date("2026-06-15T19:00:00.000Z"),
    });
    expect(result.closed).toHaveLength(1);
    // Verify the SQL parameter was the de-duped array.
    const args = (client.query as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(args[1][0]).toEqual(["v1"]);
  });

  it("collects multiple closed vendors and joins names in the message", async () => {
    const checkClosedVendorsInCart = await loadGate();
    const client = makeClient([
      {
        id: "v1",
        name: "Closed A",
        slug: "a",
        open_time: "09:00",
        close_time: "17:00",
        is_active: true,
      },
      {
        id: "v2",
        name: "Closed B",
        slug: "b",
        open_time: "09:00",
        close_time: "17:00",
        is_active: false,
      },
      {
        id: "v3",
        name: "Open C",
        slug: "c",
        open_time: "00:00",
        close_time: "23:59",
        is_active: true,
      },
    ]);
    const result = await checkClosedVendorsInCart({
      client,
      vendorIds: ["v1", "v2", "v3"],
      now: new Date("2026-06-15T19:00:00.000Z"),
    });
    expect(result.closed).toHaveLength(2);
    const names = result.closed.map((v) => v.name).sort();
    expect(names).toEqual(["Closed A", "Closed B"]);
    expect(result.message).toContain("Closed A");
    expect(result.message).toContain("Closed B");
  });
});
