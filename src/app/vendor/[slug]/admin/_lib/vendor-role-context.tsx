"use client";

/**
 * Vendor role context — exposes the signed-in vendor staff member's
 * role and a small set of permission predicates to every admin page.
 *
 * Background: the vendor admin shell has a role hierarchy (owner=4,
 * manager=3, staff=2, viewer=1) but until this provider existed,
 * every page rendered every action button unconditionally — a viewer
 * could click "Delete product" or "Save settings" and only get
 * blocked by the API. The UI now hides / disables buttons that the
 * current role cannot actually exercise, eliminating the
 * "button-works-then-403" foot-gun (audit D7a-c, D8a-j).
 *
 * The context is owned by the layout: it passes the authenticated
 * `user` in, and the children read it via `useVendorRole()`. The
 * underlying helpers (`hasMinRole`) come from
 * `@/lib/identity/vendor-auth` so server-side checks stay in lockstep.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { VendorRole } from "@/lib/identity/vendor-auth";
import { hasMinRole } from "@/lib/identity/vendor-auth";

export type { VendorRole };

/** Coarse-grained capabilities the UI cares about. */
export type VendorCapability =
  | "view_dashboard"
  | "manage_products"
  | "manage_categories"
  | "manage_coupons"
  | "manage_orders"
  | "manage_staff"
  | "manage_settings";

/**
 * Minimum role required for each capability. `viewer` can read every
 * section but cannot mutate anything; `staff` is a write-only role
 * (orders + products toggle, no settings or staff management);
 * `manager` can edit settings and coupons but not staff; only
 * `owner` can manage other staff members or transfer ownership.
 */
const CAPABILITY_MIN_ROLE: Record<VendorCapability, VendorRole> = {
  view_dashboard: "viewer",
  manage_products: "staff",
  manage_categories: "manager",
  manage_coupons: "manager",
  manage_orders: "staff",
  manage_staff: "owner",
  manage_settings: "manager",
};

interface VendorRoleContextValue {
  role: VendorRole;
  /** True if the current role is at or above `minRole`. */
  can: (minRole: VendorRole) => boolean;
  /** True if the current role can exercise `capability`. */
  canDo: (capability: VendorCapability) => boolean;
  /** Convenience flag: `true` means the role cannot mutate anything. */
  isReadOnly: boolean;
}

const VendorRoleContext = createContext<VendorRoleContextValue | null>(null);

interface VendorRoleProviderProps {
  role: VendorRole;
  children: ReactNode;
}

export function VendorRoleProvider({ role, children }: VendorRoleProviderProps) {
  const value = useMemo<VendorRoleContextValue>(() => {
    const can = (minRole: VendorRole) => hasMinRole(role, minRole);
    const canDo = (capability: VendorCapability) =>
      can(CAPABILITY_MIN_ROLE[capability]);
    return {
      role,
      can,
      canDo,
      isReadOnly: !can("staff"),
    };
  }, [role]);

  return (
    <VendorRoleContext.Provider value={value}>{children}</VendorRoleContext.Provider>
  );
}

export function useVendorRole(): VendorRoleContextValue {
  const ctx = useContext(VendorRoleContext);
  if (!ctx) {
    throw new Error("useVendorRole must be used inside a VendorRoleProvider");
  }
  return ctx;
}