/**
 * Central Order State Machine — single source of truth for status transitions
 * across the three order-related state columns:
 *
 *   1. `orders.status`            (parent order lifecycle, 6 values)
 *   2. `vendor_orders.status`     (per-vendor lifecycle, 8 values — superset of #1)
 *   3. `orders.payment_status`    (payment lifecycle, 4 values — orthogonal to #1)
 *
 * P2-1 (production hardening 2): replaces the four scattered sources of truth
 * that previously existed:
 *   - `src/lib/validation/order.ts` (orderStatusSchema, Zod enum)
 *   - `src/app/api/admin/driver/orders/[id]/route.ts` (inline validStatuses +
 *     validCurrentStatuses)
 *   - `src/app/api/v1/vendor/orders/[id]/status/route.ts` (inline
 *     VALID_TRANSITIONS map)
 *   - `src/lib/orders/order-status.ts` (UI labels, ORDER_STATUSES)
 *
 * Why centralize:
 *   - The previous inline maps drifted: the driver's "delivered" transition
 *     also flipped `payment_status='paid'` for COD, while the vendor's
 *     "delivered" did not. There was no single file to grep when a new
 *     status was added.
 *   - Adding a new status required four edits in four places, easy to miss.
 *   - Test coverage was scattered: driver + vendor transitions were tested
 *     in route tests, the parent enum in `order.test.ts`. A central
 *     `assertValidTransition` lets a single test suite cover all roles.
 *
 * Design:
 *   - `Role` enumerates the actors that can transition state.
 *   - `OrderState`, `VendorOrderState`, `PaymentState` are string literal
 *     unions — they match the Postgres enum values 1:1 so a TypeScript
 *     type mismatch at the route layer catches drift early.
 *   - `TRANSITIONS[role]` is a `Readonly<Record<State, ReadonlySet<State>>>`
 *     so callers can ask `canTransition(role, from, to)` cheaply and
 *     `assertValidTransition(role, from, to)` throws with an Arabic
 *     message that the caller can return to the user.
 *   - The state machine is pure data — no DB calls, no logging. Routes
 *     wrap it with their own transaction / side effects.
 *
 * Migration safety:
 *   - This file does NOT change the Postgres enum types. The states
 *     defined here match what migrations/001_full_schema.sql and the
 *     follow-ups already declare. New states require a migration AND
 *     an edit here.
 */

// ── State literal unions ─────────────────────────────────────────────────

/** Parent order lifecycle — matches Postgres `order_status_enum`. */
export type OrderState =
  | "pending"
  | "confirmed"
  | "shopping"
  | "on_the_way"
  | "delivered"
  | "cancelled";

/**
 * Vendor-order lifecycle — superset of OrderState. Vendor-only values
 * (preparing, ready, out_for_delivery) are interpolated into the parent's
 * `confirmed` → `on_the_way` window by the vendor PATCH route; the
 * parent row itself stays at `confirmed` until the driver picks it up.
 */
export type VendorOrderState =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

/** Payment lifecycle — orthogonal to lifecycle states. */
export type PaymentState = "pending" | "paid" | "failed" | "refunded";

/** Role whose RBAC + transition table gates the change. */
export type Role = "admin" | "vendor" | "driver" | "customer" | "system";

// ── Transition tables ────────────────────────────────────────────────────
//
// `Role → from-state → Set<to-state>`.
//
//   - `system` covers the gateway webhooks (Moyasar / Tamara) and the
//     COD driver flow. It has the broadest authority: it can flip the
//     parent lifecycle pending → confirmed when a payment is confirmed.
//   - `admin` covers admin-side overrides.
//   - `vendor` covers per-vendor status flips on `vendor_orders`.
//   - `driver` covers the delivery-leg flips on `orders`.
//   - `customer` is currently empty — there is no customer-side status
//     flip; the customer can only cancel a `pending` order.
//
// `Set` is used for O(1) lookup. A frozen Record prevents accidental
// mutation; if you need to add a transition, edit this file.

const PARENT_TRANSITIONS: Readonly<Record<OrderState, ReadonlySet<OrderState>>> = {
  pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["shopping", "on_the_way", "cancelled"]),
  shopping: new Set(["on_the_way", "cancelled"]),
  on_the_way: new Set(["delivered", "cancelled"]),
  delivered: new Set([]),
  cancelled: new Set([]),
};

/**
 * Admin-only escape hatches (operational overrides). These exist so the
 * admin can recover from real-world events that the normal flow doesn't
 * anticipate — most importantly: a customer complaint AFTER delivery
 * that requires the order to be cancelled and refunded out-of-band.
 *
 * The system role (webhooks, jobs) does NOT get these overrides: a
 * webhook must never undo a delivered state.
 */
const ADMIN_PARENT_OVERRIDES: Readonly<Record<OrderState, ReadonlySet<OrderState>>> = {
  pending: new Set([]),
  confirmed: new Set([]),
  shopping: new Set([]),
  on_the_way: new Set([]),
  delivered: new Set(["cancelled"]),
  cancelled: new Set([]),
};

function mergeTransitions<S extends string>(
  base: Readonly<Record<S, ReadonlySet<S>>>,
  overrides: Readonly<Record<S, ReadonlySet<S>>>,
): Readonly<Record<S, ReadonlySet<S>>> {
  const out = {} as Record<S, ReadonlySet<S>>;
  for (const key of Object.keys(base) as S[]) {
    const merged = new Set<S>(base[key]);
    for (const v of overrides[key] ?? []) merged.add(v);
    out[key] = merged;
  }
  return out;
}

const VENDOR_TRANSITIONS: Readonly<Record<VendorOrderState, ReadonlySet<VendorOrderState>>> = {
  pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["preparing", "cancelled"]),
  preparing: new Set(["ready", "cancelled"]),
  ready: new Set(["out_for_delivery", "cancelled"]),
  out_for_delivery: new Set(["delivered", "cancelled"]),
  delivered: new Set([]),
  cancelled: new Set([]),
  refunded: new Set([]),
};

const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, ReadonlySet<PaymentState>>> = {
  pending: new Set(["paid", "failed"]),
  paid: new Set(["refunded"]),
  failed: new Set(["pending"]), // retry on a failed card → flips back to pending
  refunded: new Set([]),
};

/**
 * The three transition tables indexed by role.
 *
 * - `admin` / `system` operate on the parent order + payment.
 * - `vendor` operates only on its own vendor_order row.
 * - `driver` operates only on the parent order's delivery leg
 *   (pending → on_the_way, on_the_way → delivered).
 * - `customer` may cancel a pending order only.
 */
export const PARENT_ORDER_TRANSITIONS_BY_ROLE: Readonly<
  Record<Role, Readonly<Record<OrderState, ReadonlySet<OrderState>>>>
> = {
  admin: mergeTransitions(PARENT_TRANSITIONS, ADMIN_PARENT_OVERRIDES),
  system: PARENT_TRANSITIONS, // webhooks, jobs
  driver: {
    // Drivers only claim from `pending` and act on orders they're already
    // assigned to (`on_the_way` → delivered/cancelled). The intermediate
    // `confirmed` / `shopping` states are admin-controlled — a driver
    // route 400s on those. See admin/driver/orders/[id]/route.ts.
    pending: new Set(["on_the_way"]),
    confirmed: new Set([]),
    shopping: new Set([]),
    on_the_way: new Set(["delivered", "cancelled"]),
    delivered: new Set([]),
    cancelled: new Set([]),
  },
  vendor: {
    // Vendors don't directly mutate orders.status — they update
    // vendor_orders.status. Mirror the parent with a narrow window
    // so a vendor-staff route accidentally writing to the parent
    // table gets rejected here too.
    pending: new Set([]),
    confirmed: new Set([]),
    shopping: new Set([]),
    on_the_way: new Set([]),
    delivered: new Set([]),
    cancelled: new Set([]),
  },
  customer: {
    pending: new Set(["cancelled"]),
    confirmed: new Set([]),
    shopping: new Set([]),
    on_the_way: new Set([]),
    delivered: new Set([]),
    cancelled: new Set([]),
  },
};

export const VENDOR_ORDER_TRANSITIONS_BY_ROLE: Readonly<
  Record<Role, Readonly<Record<VendorOrderState, ReadonlySet<VendorOrderState>>>>
> = {
  admin: VENDOR_TRANSITIONS,
  system: VENDOR_TRANSITIONS,
  vendor: VENDOR_TRANSITIONS,
  driver: {
    // Drivers don't write to vendor_orders; they write to orders.
    pending: new Set([]),
    confirmed: new Set([]),
    preparing: new Set([]),
    ready: new Set([]),
    out_for_delivery: new Set([]),
    delivered: new Set([]),
    cancelled: new Set([]),
    refunded: new Set([]),
  },
  customer: {
    pending: new Set(["cancelled"]),
    confirmed: new Set([]),
    preparing: new Set([]),
    ready: new Set([]),
    out_for_delivery: new Set([]),
    delivered: new Set([]),
    cancelled: new Set([]),
    refunded: new Set([]),
  },
};

export const PAYMENT_TRANSITIONS_BY_ROLE: Readonly<
  Record<Role, Readonly<Record<PaymentState, ReadonlySet<PaymentState>>>>
> = {
  admin: PAYMENT_TRANSITIONS,
  system: PAYMENT_TRANSITIONS, // webhooks + COD driver flow
  vendor: {
    pending: new Set([]),
    paid: new Set([]),
    failed: new Set([]),
    refunded: new Set([]),
  },
  driver: {
    // Driver only flips pending → paid (COD collection). Everything
    // else goes through the admin or system role.
    pending: new Set(["paid"]),
    paid: new Set([]),
    failed: new Set([]),
    refunded: new Set([]),
  },
  customer: {
    pending: new Set([]),
    paid: new Set([]),
    failed: new Set([]),
    refunded: new Set([]),
  },
};

// ── Query API ────────────────────────────────────────────────────────────

/** Cheap boolean predicate — does the role allow this transition? */
export function canTransition(
  role: Role,
  column: "orders" | "vendor_orders" | "payment",
  from: string,
  to: string,
): boolean {
  const table = column === "orders"
    ? PARENT_ORDER_TRANSITIONS_BY_ROLE[role]
    : column === "vendor_orders"
      ? VENDOR_ORDER_TRANSITIONS_BY_ROLE[role]
      : PAYMENT_TRANSITIONS_BY_ROLE[role];
  const allowed = (table as Record<string, ReadonlySet<string>>)[from];
  return Boolean(allowed?.has(to));
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly role: Role,
    public readonly column: "orders" | "vendor_orders" | "payment",
    public readonly from: string,
    public readonly to: string,
  ) {
    super(
      `[state-machine] role=${role} cannot transition ${column}.status ` +
      `from '${from}' to '${to}'`,
    );
    this.name = "InvalidTransitionError";
  }
}

/**
 * Throws InvalidTransitionError if the transition is not allowed for the
 * given role. Routes catch this and return a 400 with the Arabic message.
 *
 * Arabic message is included in the error so the route can pass it
 * straight to the caller without remapping.
 */
export function assertValidTransition(
  role: Role,
  column: "orders" | "vendor_orders" | "payment",
  from: string,
  to: string,
): void {
  if (!canTransition(role, column, from, to)) {
    throw new InvalidTransitionError(role, column, from, to);
  }
}

/**
 * Returns a user-facing Arabic message for an InvalidTransitionError.
 * Routes use this to build the 400 body.
 */
export function invalidTransitionMessage(
  role: Role,
  column: "orders" | "vendor_orders" | "payment",
  from: string,
  to: string,
): string {
  if (column === "payment") {
    return `لا يمكن تغيير حالة الدفع من "${from}" إلى "${to}"`;
  }
  return `لا يمكن تغيير حالة الطلب من "${from}" إلى "${to}"`;
}

// ── UI display maps (extracted to a separate module, audit C10) ─────────
//
// The `ORDER_STATE_DISPLAY` / `VENDOR_ORDER_STATE_DISPLAY` /
// `PAYMENT_STATE_DISPLAY` maps + the `OrderStateDisplay` interface
// now live in `./order-status-display` so the canonical state-machine
// file stays pure (no UI deps). They are re-exported here for
// backward compatibility — new code should import them from the
// dedicated module.
export {
  ORDER_STATE_DISPLAY,
  VENDOR_ORDER_STATE_DISPLAY,
  PAYMENT_STATE_DISPLAY,
} from "./order-status-display";
export type { OrderStateDisplay } from "./order-status-display";

// ── Zod re-exports for boundary validation ───────────────────────────────
//
// `orderStatusSchema` in `src/lib/validation/order.ts` historically
// owned the parent enum. Re-export the same shape here so callers
// can move to the canonical source without a breaking change. The
// Zod schema itself stays in `validation/order.ts` to avoid pulling
// lucide-react into the boundary-validation layer.

export const ALL_ORDER_STATES: readonly OrderState[] = [
  "pending",
  "confirmed",
  "shopping",
  "on_the_way",
  "delivered",
  "cancelled",
];

export const ALL_VENDOR_ORDER_STATES: readonly VendorOrderState[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
];

export const ALL_PAYMENT_STATES: readonly PaymentState[] = [
  "pending",
  "paid",
  "failed",
  "refunded",
];

// ── Derived status sets ────────────────────────────────────────────────────
//
// Single source of truth for "which order statuses should surface to which
// audience?". Routes that filter rows by status previously inlined these
// as array literals (`'pending','shopping' | ...`) which drifted across
// the admin, driver, and vendor dashboards. Derived from the canonical
// enums above so a new OrderState automatically lights up everywhere.

export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderState> = new Set([
  "delivered",
  "cancelled",
]);

export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentState> = new Set([
  "paid",
  "refunded",
]);

export const DRIVER_VISIBLE_STATUSES: ReadonlySet<OrderState> = new Set([
  "pending",
  "on_the_way",
  "delivered",
  "cancelled",
]);

export const DRIVER_TERMINAL_STATUSES: ReadonlySet<OrderState> = new Set([
  "delivered",
  "cancelled",
]);

export const ADMIN_VISIBLE_STATUSES: ReadonlySet<OrderState> = new Set([
  "pending",
  "confirmed",
  "shopping",
  "on_the_way",
  "delivered",
  "cancelled",
]);
