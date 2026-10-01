import { describe, expect, it, vi } from "vitest";
import {
  findDriverIdByAdminUser,
  postDirectOrderSystemMessage,
  releaseCouponUseForOrder,
} from "./order-repository";

const db = (rows: unknown[] = []) => ({ query: vi.fn(async () => ({ rows }) as never) });

describe("order-repository", () => {
  it("findDriverIdByAdminUser returns the linked driver id or null", async () => {
    expect(await findDriverIdByAdminUser(db([{ id: "d1" }]), "a1")).toBe("d1");
    expect(await findDriverIdByAdminUser(db([]), "a1")).toBeNull();
  });

  it("requireActiveAdmin joins admin_users and checks is_active", async () => {
    const d = db([{ id: "d1" }]);
    await findDriverIdByAdminUser(d, "a1", { requireActiveAdmin: true });
    const [sql, params] = d.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/JOIN admin_users/);
    expect(sql).toMatch(/is_active = true/);
    expect(params).toEqual(["a1"]);
  });

  it("releaseCouponUseForOrder never drops below zero", async () => {
    const d = db();
    await releaseCouponUseForOrder(d, "o1");
    const [sql, params] = d.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/GREATEST\(used_count - 1, 0\)/);
    expect(sql).toMatch(/used_count > 0/);
    expect(params).toEqual(["o1"]);
  });

  it("postDirectOrderSystemMessage attributes to an admin only when given", async () => {
    const withAdmin = db();
    await postDirectOrderSystemMessage(withAdmin, { orderId: "o1", adminId: "a1", body: "b" });
    expect((withAdmin.query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual(["o1", "a1", "b"]);
    const plain = db();
    await postDirectOrderSystemMessage(plain, { orderId: "o1", body: "b" });
    const [sql, params] = plain.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toMatch(/sender_admin_id/);
    expect(params).toEqual(["o1", "b"]);
  });
});
