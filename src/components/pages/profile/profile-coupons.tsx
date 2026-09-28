"use client";

import { AvailableCoupons } from "@/components/pages/coupons/AvailableCoupons";

// Phase 1 / T6: profile-coupons now delegates to the shared
// AvailableCoupons component (page variant). All visual + behavioral
// changes should happen in AvailableCoupons, not here.
export function ProfileCoupons() {
  return <AvailableCoupons variant="page" />;
}