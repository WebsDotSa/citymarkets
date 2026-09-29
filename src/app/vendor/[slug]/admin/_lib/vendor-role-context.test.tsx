import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Regression tests for the vendor role context.
 *
 * Bug D7 + D8 (vendor permission UI gating): every vendor admin page
 * used to render every action button unconditionally. Viewers could
 * click "Delete product" / "Save settings" / "Cancel order" and only
 * get blocked by the API. The fix:
 *
 *   1. Layout exposes the authenticated user's role via
 *      `VendorRoleProvider`.
 *   2. Each page reads it via `useVendorRole()` and gates its
 *      buttons (or wraps the form in a `<fieldset disabled>`).
 *
 * These tests pin down the role hierarchy and capability predicates so
 * the gate stays in lockstep with `hasMinRole` in
 * `@/lib/identity/vendor-auth`.
 */

import { VendorRoleProvider, useVendorRole } from "./vendor-role-context";

function withRole(role: Parameters<typeof VendorRoleProvider>[0]["role"]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <VendorRoleProvider role={role}>{children}</VendorRoleProvider>;
  };
}

describe("VendorRoleProvider — role hierarchy (D7 base)", () => {
  it("owner is at or above every other role", () => {
    const { result } = renderHook(() => useVendorRole(), {
      wrapper: withRole("owner"),
    });
    expect(result.current.can("owner")).toBe(true);
    expect(result.current.can("manager")).toBe(true);
    expect(result.current.can("staff")).toBe(true);
    expect(result.current.can("viewer")).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
  });

  it("manager cannot reach owner-only capabilities", () => {
    const { result } = renderHook(() => useVendorRole(), {
      wrapper: withRole("manager"),
    });
    expect(result.current.can("owner")).toBe(false);
    expect(result.current.can("manager")).toBe(true);
    expect(result.current.can("staff")).toBe(true);
    expect(result.current.can("viewer")).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
  });

  it("staff can write products and orders but not coupons/settings/staff", () => {
    const { result } = renderHook(() => useVendorRole(), {
      wrapper: withRole("staff"),
    });
    expect(result.current.can("manager")).toBe(false);
    expect(result.current.can("staff")).toBe(true);
    expect(result.current.canDo("manage_products")).toBe(true);
    expect(result.current.canDo("manage_orders")).toBe(true);
    expect(result.current.canDo("manage_coupons")).toBe(false);
    expect(result.current.canDo("manage_categories")).toBe(false);
    expect(result.current.canDo("manage_settings")).toBe(false);
    expect(result.current.canDo("manage_staff")).toBe(false);
    expect(result.current.isReadOnly).toBe(false);
  });

  it("viewer cannot mutate anything", () => {
    const { result } = renderHook(() => useVendorRole(), {
      wrapper: withRole("viewer"),
    });
    expect(result.current.can("staff")).toBe(false);
    expect(result.current.can("viewer")).toBe(true);
    expect(result.current.canDo("manage_products")).toBe(false);
    expect(result.current.canDo("manage_orders")).toBe(false);
    expect(result.current.canDo("manage_coupons")).toBe(false);
    expect(result.current.canDo("manage_categories")).toBe(false);
    expect(result.current.canDo("manage_settings")).toBe(false);
    expect(result.current.canDo("manage_staff")).toBe(false);
    expect(result.current.isReadOnly).toBe(true);
  });
});

describe("VendorRoleProvider — capability matrix (D7a-c, D8a-j pin)", () => {
  // Each row is a (role, capability, expected) triple.
  const cases: Array<
    [
      Parameters<typeof VendorRoleProvider>[0]["role"],
      "manage_products" | "manage_categories" | "manage_coupons" | "manage_orders" | "manage_staff" | "manage_settings",
      boolean,
    ]
  > = [
    // products: staff+
    ["owner", "manage_products", true],
    ["manager", "manage_products", true],
    ["staff", "manage_products", true],
    ["viewer", "manage_products", false],
    // orders: staff+
    ["owner", "manage_orders", true],
    ["manager", "manage_orders", true],
    ["staff", "manage_orders", true],
    ["viewer", "manage_orders", false],
    // categories: manager+
    ["owner", "manage_categories", true],
    ["manager", "manage_categories", true],
    ["staff", "manage_categories", false],
    ["viewer", "manage_categories", false],
    // coupons: manager+
    ["owner", "manage_coupons", true],
    ["manager", "manage_coupons", true],
    ["staff", "manage_coupons", false],
    ["viewer", "manage_coupons", false],
    // settings: manager+
    ["owner", "manage_settings", true],
    ["manager", "manage_settings", true],
    ["staff", "manage_settings", false],
    ["viewer", "manage_settings", false],
    // staff: owner-only
    ["owner", "manage_staff", true],
    ["manager", "manage_staff", false],
    ["staff", "manage_staff", false],
    ["viewer", "manage_staff", false],
  ];

  for (const [role, cap, expected] of cases) {
    it(`${role} → ${cap} = ${expected}`, () => {
      const { result } = renderHook(() => useVendorRole(), {
        wrapper: withRole(role),
      });
      expect(result.current.canDo(cap)).toBe(expected);
    });
  }
});

describe("VendorRoleProvider — hook contract", () => {
  it("throws a descriptive error when used outside the provider", () => {
    // Render outside the wrapper so the context is null.
    expect(() => renderHook(() => useVendorRole())).toThrow(
      /useVendorRole must be used inside a VendorRoleProvider/,
    );
  });
});