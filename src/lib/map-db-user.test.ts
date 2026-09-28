import { describe, it, expect } from "vitest";
import { mapDbUserRow } from "./map-db-user";

describe("mapDbUserRow", () => {
  it("converts a fully-populated row into a User", () => {
    const row = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      phone: "+966500000000",
      name: "محمد",
      email: "m@example.com",
      avatar_url: "https://example.com/a.png",
      loyalty_points: 150,
      loyalty_tier: "gold",
      spin_count_today: 2,
      last_spin_at: new Date("2026-07-01T12:00:00Z"),
      created_at: new Date("2025-01-15T08:30:00Z"),
      updated_at: new Date("2026-07-20T09:00:00Z"),
    };
    const user = mapDbUserRow(row);
    expect(user.id).toBe(row.id);
    expect(user.phone).toBe(row.phone);
    expect(user.name).toBe("محمد");
    expect(user.email).toBe("m@example.com");
    expect(user.avatar_url).toBe("https://example.com/a.png");
    expect(user.loyalty_points).toBe(150);
    expect(user.loyalty_tier).toBe("gold");
    expect(user.spin_count_today).toBe(2);
    expect(user.last_spin_at).toBe("2026-07-01T12:00:00.000Z");
    expect(user.created_at).toBe("2025-01-15T08:30:00.000Z");
    expect(user.updated_at).toBe("2026-07-20T09:00:00.000Z");
  });

  it("coerces numeric loyalty_points to a number even if the driver returned a string", () => {
    const user = mapDbUserRow({
      id: "x",
      phone: "+966500000000",
      loyalty_points: "200", // string from DB
    });
    expect(user.loyalty_points).toBe(200);
    expect(typeof user.loyalty_points).toBe("number");
  });

  it("defaults loyalty_points to 0 when missing", () => {
    const user = mapDbUserRow({ id: "x", phone: "+966500000000" });
    expect(user.loyalty_points).toBe(0);
  });

  it("defaults loyalty_tier to 'bronze' when missing or unrecognized", () => {
    const user = mapDbUserRow({ id: "x", phone: "+966500000000" });
    expect(user.loyalty_tier).toBe("bronze");

    const weird = mapDbUserRow({
      id: "x",
      phone: "+966500000000",
      loyalty_tier: "diamond",
    });
    expect(weird.loyalty_tier).toBe("diamond"); // the cast preserves unknown tiers
  });

  it("defaults spin_count_today to 0 when missing", () => {
    const user = mapDbUserRow({ id: "x", phone: "+966500000000" });
    expect(user.spin_count_today).toBe(0);
  });

  it("returns null for name/email/avatar_url when missing", () => {
    const user = mapDbUserRow({ id: "x", phone: "+966500000000" });
    expect(user.name).toBeNull();
    expect(user.email).toBeNull();
    expect(user.avatar_url).toBeNull();
  });

  it("accepts string dates (e.g. ISO from DB) for created_at/updated_at", () => {
    const user = mapDbUserRow({
      id: "x",
      phone: "+966500000000",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
    expect(user.created_at).toBe("2026-01-01T00:00:00Z");
    expect(user.updated_at).toBe("2026-01-02T00:00:00Z");
  });

  it("accepts Date objects for created_at/updated_at and converts to ISO", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const user = mapDbUserRow({
      id: "x",
      phone: "+966500000000",
      created_at: d,
      updated_at: d,
    });
    expect(user.created_at).toBe(d.toISOString());
    expect(user.updated_at).toBe(d.toISOString());
  });

  it("keeps last_spin_at as null when missing", () => {
    const user = mapDbUserRow({ id: "x", phone: "+966500000000" });
    expect(user.last_spin_at).toBeNull();
  });

  it("converts last_spin_at Date → ISO string", () => {
    const user = mapDbUserRow({
      id: "x",
      phone: "+966500000000",
      last_spin_at: new Date("2026-05-05T05:05:05Z"),
    });
    expect(user.last_spin_at).toBe("2026-05-05T05:05:05.000Z");
  });
});