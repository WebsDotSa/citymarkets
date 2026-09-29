/**
 * Public barrel for the validation module.
 *
 * Every export below was previously defined inline in
 * `src/lib/validation.ts` (1252-line god file, 2026-09-24 split).
 * External callers continue to `import { ... } from "@/lib/validation"`
 * unchanged — this barrel re-exports everything that used to be
 * top-level in the old file.
 *
 * Internal organization:
 *   - schemas.ts      — phone, uuid, pagination, search, coupon code,
 *                       payment method, + validateBody / validationError
 *                       (folded from helpers.ts — audit H33)
 *   - auth.ts         — phone-OTP login, admin login, password, push
 *   - address.ts      — customer addresses
 *   - order.ts        — cart, order create/edit, direct order, reviews
 *   - checkout.ts     — Slice 3 multi-vendor unified checkout
 *   - product.ts      — admin product/category/banner CRUD
 *   - vendor.ts       — admin vendor CRUD
 *   - admin.ts        — admin user/inventory/delivery/coupon/offer
 *   - broadcast.ts    — broadcasts, templates, realtime events
 *   - upload.ts       — MIME allowlist, size ceilings, magic bytes
 *   - home-layout.ts  — admin home-layout grid
 *   - primitives.ts   — internal Zod primitives (NOT re-exported)
 */

export * from "./schemas";
export * from "./auth";
export * from "./address";
export * from "./order";
export * from "./checkout";
export * from "./product";
export * from "./vendor";
export * from "./admin";
export * from "./broadcast";
export * from "./upload";
export * from "./home-layout";