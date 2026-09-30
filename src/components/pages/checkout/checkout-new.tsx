"use client";

/**
 * CheckoutNew — the unified multi-vendor checkout experience.
 *
 * The `-new` suffix is intentional (audit H34): this file replaced an
 * older single-vendor `checkout.tsx` flow during the Slice 3 checkout
 * consolidation (see docs/01). The legacy file was removed; the new
 * one kept the `-new` discriminator so existing route imports at
 * src/app/checkout/page.tsx don't need to change. Do NOT rename this
 * file without auditing the 1 importer + any historical iOS deep links
 * that may pin the symbol.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/contexts/cart-context";
import { useAuthState } from "@/contexts/auth-context";
import { useDeliveryLocationActions, useDeliveryLocationState } from "@/contexts/delivery-location-context";
import { useDeliveryQuote } from "@/hooks/use-delivery-quote";
import { CardIcon, ApplePayIcon, VisaIcon, MastercardIcon, AmexIcon, WalletIcon, BankIcon } from "@/components/icons/payment";
import { MoyasarCheckoutForm, type CheckoutMoyasarMethod } from "@/components/checkout/moyasar-checkout-form";
import { BankTransferCard } from "@/components/checkout/bank-transfer-card";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { groupCartItems } from "@/lib/catalog";
import { PAYMENT_METHODS_UI, ONLINE_RETRY_METHODS_SET } from "@/lib/payments/payment-methods";
import type { CouponValidateResult } from "@/lib/types";
import { AvailableCoupons } from "@/components/pages/coupons/AvailableCoupons";
import { trackBeginCheckout } from "@/lib/ga-events";
import {
  DeliverySchedulePicker,
  type ScheduledSelection,
} from "./delivery-schedule-picker";
import Image from "next/image";
import {
  ShoppingCart,
  MapPin,
  CreditCard,
  Check,
  ArrowLeft,
  Plus,
  Tag,
  AlertCircle,
  ChevronDown,
  Receipt,
  Shield,
  Clock,
  Truck,
  Package,
  Trash2,
  Loader2,
} from "lucide-react";

interface Address {
  id: string;
  label: string;
  // `/api/v1/addresses` returns `address_text` (the row-level address)
  // and `description` (free-form detail). The local UI used to declare
  // only `address`, which left the address list and the confirm-screen
  // summary visually empty even though addresses were correctly loaded.
  // `address` is kept as a fallback so a future shape still renders.
  address?: string;
  address_text?: string | null;
  description?: string | null;
  city?: string;
  building?: string;
  floor?: string;
  instructions?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  is_default: boolean;
}

// The /api/v1/coupons/validate endpoint returns a server-canonical discount
// so the checkout total reflects the real value before order creation. The
// server re-validates at /api/v1/orders time (defense-in-depth), so a stale
// UI value never reaches the persisted order.
type CouponResult = CouponValidateResult;

/**
 * Re-exported under the local name `INLINE_MOYASAR_METHODS` for clarity at
 * call sites — the canonical Set lives at `@/lib/payments/payment-methods`.
 */
function isInlineMoyasarMethod(method: string): boolean {
  return ONLINE_RETRY_METHODS_SET.has(method);
}

// Operator decision (2026-09-20): cash, stc_pay, tamara removed from the
// customer-facing picker. The single source of truth for the visible
// methods is `PAYMENT_METHODS_UI` in `src/lib/payment-methods.ts`; this
// file maps the icon component for each id.
//
// Server canonical tokens are used here so orders.payment_method matches
// the admin `PAYMENT_METHOD_AR` map and analytics queries. The online
// card set (mada/visa/mastercard/amex/apple_pay) triggers the inline
// Moyasar form; wallet + bank_transfer short-circuit at the confirm step.
// Server canonical tokens (mada/visa/mastercard/amex/apple_pay/wallet/
// bank_transfer) come from `PAYMENT_METHODS_UI` in `src/lib/payments/payment-methods.ts`.
// That registry owns the canonical Arabic name + description + icon asset
// path; the only thing this client component adds is the icon-component
// resolution (string → React component). Keeping the strings in one
// place avoids drift between the picker, the admin `PAYMENT_METHOD_AR`
// map, and analytics queries.
type CheckoutPaymentIcon = React.ComponentType<{ className?: string }>;
const PAYMENT_ICON_COMPONENTS: Record<string, CheckoutPaymentIcon> = {
  mada: CardIcon,
  visa: VisaIcon,
  mastercard: MastercardIcon,
  amex: AmexIcon,
  apple_pay: ApplePayIcon,
  wallet: WalletIcon,
  bank_transfer: BankIcon,
};
const PAYMENT_METHODS = PAYMENT_METHODS_UI.map((m) => ({
  id: m.id,
  name: m.name,
  icon: PAYMENT_ICON_COMPONENTS[m.id] ?? CardIcon,
  src: m.src,
  description: m.description,
}));

// Reusable section card — keeps the visual rhythm consistent across
// delivery mode, address, payment, coupon, and summary. Each card
// has a colored icon chip + a label + an optional "completed" check
// once the user has filled it in. The card flips to a "done" state
// when the inner field is satisfied (e.g. an address is picked),
// so the user can scan the page and see which sections still need
// attention before they tap "تأكيد الطلب".
function SectionCard({
  index,
  icon: Icon,
  title,
  done,
  invalid,
  children,
  className = "",
}: {
  index: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  done?: boolean;
  invalid?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative bg-white rounded-2xl border ${invalid ? "border-red-300" : "border-gray-200"} shadow-sm overflow-hidden ${className}`}
    >
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-l from-gray-50 to-white">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            invalid
              ? "bg-red-100 text-red-600"
              : done
                ? "bg-primary-100 text-primary-700"
                : "bg-gray-100 text-gray-500"
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-gray-400 tabular-nums">
            {String(index).padStart(2, "0")}
          </span>
          <h2 className="text-base font-bold text-gray-900 leading-tight">
            {title}
          </h2>
        </div>
        {done && !invalid && (
          <Check className="w-5 h-5 text-primary-600 flex-shrink-0 ms-auto" />
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CheckoutNew() {
  const router = useRouter();
  const { user } = useAuthState();
  const { openSheet } = useDeliveryLocationActions();
  // Migration 078 (2026-09-30): pull the canonical address list +
  // selection directly from the delivery-location context instead of
  // running a parallel `fetch('/api/v1/addresses')` on mount. The
  // context already GETs `/api/v1/delivery-addresses` (which supports
  // BOTH user + guest sessions); doing a second round-trip on the
  // checkout page created a race where the local `addresses` state
  // and the context's `addresses` could disagree (e.g. after
  // `addAddress` finishes in the sheet the local state would still
  // show the stale list).
  const {
    addresses: contextAddresses,
    selectedAddress: contextSelectedAddress,
  } = useDeliveryLocationState();
  const { items, subtotal, clearCart, isHydrated } = useCart();
  const { showToast } = useToast();
  // The checkout still keeps a local `addresses` shadow list so the
  // delete handler can remove a row optimistically without round-
  // tripping the context's `refreshAddresses`. The initial value
  // comes from the context so the two lists stay in sync from frame 1.
  const [addresses, setAddresses] = useState<Address[]>(contextAddresses);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(
    contextSelectedAddress ?? null,
  );
  // ميسر (Moyasar) is the default — picking it mounts the inline payment
  // form so the customer can enter card details without leaving the page.
  // Cash remains an opt-in for customers who prefer to pay on delivery.
  const [selectedPayment, setSelectedPayment] = useState<string>("mada");
  const [isProcessing, setIsProcessing] = useState(false);
  // SECURITY (Pay-Dup): synchronous double-submit lock. `disabled`
  // on the button relies on React state and so updates asynchronously;
  // a fast double-click can still register two onClick handlers before
  // the first state commit. The ref flips synchronously inside the
  // same event-loop tick.
  const submittingRef = useRef(false);
  // SECURITY (Pay-Dup): idempotency key generated once per checkout
  // session and sent with the order POST. The orders route returns the
  // existing order on the second call instead of creating a duplicate.
  const idempotencyKeyRef = useRef<string | null>(null);
  // "pickup" skips address resolution and delivery fees entirely — the
  // server (/api/v1/orders) short-circuits zone lookup when
  // delivery_type === 'pickup', so the UI must mirror that.
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");
  const isPickup = deliveryMode === "pickup";
  // Scheduled-delivery selection. Defaults to express; flips to
  // scheduled once the user picks a slot in the picker. The schedule
  // picker is rendered only for delivery (pickup orders are always
  // express — the server rejects scheduled + pickup with 400).
  const [schedule, setSchedule] = useState<ScheduledSelection>({ mode: "express" });
  // The Address interface now carries `lat` / `lng` directly (the
  // `/api/v1/addresses` row shape). No cast needed.
  const selLat = selectedAddress?.lat;
  const selLng = selectedAddress?.lng;
  const hasCoords =
    selLat != null &&
    selLng != null &&
    Number.isFinite(Number(selLat)) &&
    Number.isFinite(Number(selLng));
  const addrCoords =
    !isPickup && selectedAddress && hasCoords
      ? { lat: Number(selLat), lng: Number(selLng) }
      : null;
  const quote = useDeliveryQuote(subtotal, addrCoords);
  const deliveryFee = isPickup || quote.needsAddress ? 0 : quote.fee;
  // Service fee + tax are zeroed out for pickup (no admin overhead) and
  // when the quote hasn't loaded yet (otherwise the bottom bar would
  // flash random numbers while the user is still picking an address).
  // They come from the same endpoint that powers `quote.fee`, so a
  // single network round-trip covers all four cost lines.
  const serviceFee = isPickup || quote.needsAddress ? 0 : quote.serviceFee;
  const tax = isPickup || quote.needsAddress ? 0 : quote.tax;
  // Coupon state. Validation goes through /api/v1/coupons/validate so the
  // displayed discount is server-canonical — the order POST re-validates
  // before insert. Mirrors the CartV2 pattern.
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const couponDiscount = couponResult?.valid ? Number(couponResult.discount ?? 0) : 0;
  const total = Math.max(
    0,
    subtotal + deliveryFee + serviceFee + tax - couponDiscount,
  );

  // Validation flags — invalid sections are highlighted in red after
  // the user taps "تأكيد الطلب" with missing fields. The page also
  // smooth-scrolls to the first invalid section so the error is
  // visible without hunting through the page.
  const [showValidation, setShowValidation] = useState(false);
  const addressInvalid = !isPickup && !selectedAddress;
  const paymentInvalid = !selectedPayment;
  const sectionRefs = {
    address: useRef<HTMLDivElement>(null),
    schedule: useRef<HTMLDivElement>(null),
    payment: useRef<HTMLDivElement>(null),
  } as const;

  // Inline Moyasar state. After a successful POST /api/v1/checkout for
  // an online payment method, the server returns `inline_payment: true`
  // and we render the MoyasarCheckoutForm RIGHT HERE on the same page
  // (replacing the sticky CTA). The user enters card / Apple Pay / mada
  // details without leaving the checkout context. On payment success we
  // navigate to /checkout/success which re-verifies the status.
  // Hosted-invoice flow (no publishable key configured) still falls
  // back to window.location.href = paymentUrl.
  const [inlineOrder, setInlineOrder] = useState<
    | { orderId: string; totalSar: number; method: CheckoutMoyasarMethod }
    | null
  >(null);
  const [payError, setPayError] = useState<string | null>(null);
  const inlineMethod = isInlineMoyasarMethod(selectedPayment)
    ? (selectedPayment as CheckoutMoyasarMethod)
    : null;
  // Operator decision (2026-09-20): `stc_pay`, `tamara`, `cash` removed.
  // Bank transfer is a manual flow — never mounts the inline Moyasar
  // form, and never auto-creates the order (the explicit
  // "تأكيد الطلب" tap is required to mint the idempotency key).
  const isBankTransferSelected = selectedPayment === "bank_transfer";

  // `addresses.map` and the confirm-screen summary both render an
  // address text line. The API row uses `address_text`; older payloads
  // or test fixtures use `address`/`description`. Use whichever is
  // populated so neither screen shows an empty body.
  const addressTextOf = (a: Address | null | undefined): string =>
    (a?.address_text || a?.address || a?.description || "").trim();

  // Sync from the delivery-location context (user + guest aware).
  // Migration 078 (2026-09-30): removed the duplicate
  // `fetch('/api/v1/addresses')` here — the context is the single
  // source of truth. When the context adds/removes an address we
  // mirror the change into our local `addresses` so the inline delete
  // UX keeps working without a full refresh.
  //
  // The two types differ slightly (DeliveryAddress uses lat:number,
  // local Address allows lat:number|string|null). Cast at the boundary.
  useEffect(() => {
    setAddresses(contextAddresses as unknown as Address[]);
    if (!selectedAddress && contextSelectedAddress) {
      setSelectedAddress(contextSelectedAddress as unknown as Address);
    }
  }, [contextAddresses, contextSelectedAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // META PIXEL — fire InitiateCheckout exactly once per checkout page
  // mount, with the live cart contents. Carts in citymarkets.sa are
  // synchronous client state, so we read from `useCart()` directly — no
  // API round-trip — to guarantee the value matches what the user sees
  // on the cost summary at the moment they landed on /checkout.
  //
  // The ref guard matters because:
  //   1. React StrictMode in dev double-invokes effects, which would
  //      otherwise produce duplicate InitiateCheckout events that Meta
  //      counts as two separate checkouts.
  //   2. The cart `items` array is intentionally excluded from deps so
  //      this fires on mount, not on every cart mutation. A user who
  //      adjusts qty in checkout will not re-fire the event.
  // The empty-cart guard mirrors the JSX branch that renders the
  // "السلة فارغة" screen, so the event never fires when the page
  // shows that view.
  const initiateCheckoutFiredRef = useRef(false);
  useEffect(() => {
    if (initiateCheckoutFiredRef.current) return;
    // Wait for the cart context to hydrate from localStorage. On the
    // first client render, `useCart()` returns `items: []` because the
    // CartProvider starts empty and only loads the persisted cart in a
    // post-mount effect (avoids an SSR hydration mismatch). Without this
    // guard the InitiateCheckout effect runs ONCE with items=[] and the
    // `initiateCheckoutFiredRef.current = true` latch prevents it from
    // re-firing once items finally populate — Meta Events Manager then
    // shows zero InitiateCheckout events even though the user is on the
    // checkout page with a full cart.
    if (!isHydrated) return;
    if (items.length === 0) return;
    const value = items.reduce(
      (sum, it) =>
        sum +
        (Number(it.product.discount_price) || Number(it.product.price)) *
          it.quantity,
      0,
    );
    trackBeginCheckout({
      currency: "SAR",
      value,
      items: items.map((it) => ({
        item_id: it.product.id,
        item_name: it.product.name_ar ?? it.product.name_en ?? it.product.id,
        price: Number(it.product.discount_price ?? it.product.price ?? 0),
        quantity: it.quantity,
      })),
    });
    initiateCheckoutFiredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, items.length]);

  /**
   * Shared order-creation routine used by:
   *   1. `handlePlaceOrder` — the explicit "تأكيد الطلب" click (cash).
   *   2. The auto-create effect — runs whenever an online payment
   *      method is selected AND a delivery address is chosen (or
   *      pickup). The first time those line up it POSTs
   *      /api/v1/checkout so the parent order exists before the
   *      Moyasar form mounts.
   *
   * Returns a tagged union describing what to do next. Isolating the
   * CSRF / zod / routing logic in one place keeps the auto-effect and
   * the button click from drifting apart.
   */
  const createOrder = async ({
    source,
  }: {
    source: "auto" | "manual";
  }): Promise<
    | { kind: "inline_mounted"; orderId: string; total: number }
    | { kind: "hosted_redirect"; paymentUrl: string; orderId: string }
    | { kind: "success_no_payment"; orderId: string }
    | { kind: "error" }
  > => {
    try {
      // Slice 3: group items by vendor so the new endpoint can route
      // each group to its own vendor order. The catalog (City Markets)
      // stays in `items`; third-party vendors go to `vendor_groups`.
      const groups = groupCartItems(items);
      const catalogItems = groups.catalogItems.map((it) => ({
        product_id: it.product.id,
        quantity: it.quantity,
      }));
      const vendorGroups = groups.vendorGroups.map((g) => ({
        vendor_id: g.vendorId,
        items: g.items.map((it) => ({
          product_id: it.product.id,
          quantity: it.quantity,
        })),
      }));

      // csrfFetch attaches the `x-csrf-token` header that the proxy
      // double-submit gate requires on POST /api/v1/checkout. Without it,
      // the server returns 403 `انتهاك أمان - رمز التحقق غير صالح`.
      // coupon_code uses `.optional()` in the schema (z.string() with no
      // `.nullable()`), so omitting the key when no coupon is applied is
      // the safe path. Sending `null` triggers "Expected string, received
      // null" — see validation.ts:749 and validation.test.ts:455.
      const body: Record<string, unknown> = {
        items: catalogItems,
        vendor_groups: vendorGroups,
        delivery_type: deliveryMode,
        address_id: isPickup ? null : selectedAddress!.id,
        payment_method: selectedPayment,
        // SECURITY (Pay-Dup): idempotency key generated once per
        // checkout session. The checkout route checks for an existing
        // order with this key BEFORE inserting — if the user (or a
        // retrying script) submits twice, the second call returns the
        // same order instead of creating a duplicate.
        idempotency_key:
          idempotencyKeyRef.current ||
          (idempotencyKeyRef.current = crypto.randomUUID()),
      };
      // Scheduled-delivery slot. The server validates against the
      // active `delivery_settings.slots` config + remaining capacity;
      // a stale or full slot is rejected with 400 + Arabic message.
      if (schedule.mode === "scheduled") {
        body.scheduled = true;
        body.scheduled_for = schedule.scheduled_for;
        body.slot_id = schedule.slot_id;
      }
      // Send the validated coupon code. The checkout route re-runs the
      // full validation (active, not expired, min_order, used_count) and
      // either applies the discount or rejects the order — so a stale
      // client value cannot over-discount the persisted row. Omit the
      // key entirely when no valid coupon is applied (the schema's
      // `.optional()` rejects explicit nulls).
      if (couponResult?.valid && couponResult.code) {
        body.coupon_code = couponResult.code;
      }
      const response = await csrfFetch("/api/v1/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.success) {
        // Per-vendor closed gate (409). Render a specific toast that
        // names the offending vendors so the customer knows which items
        // to remove — the route already returns an Arabic-friendly
        // message in `result.error`; we append the vendor list when the
        // caller (admin/devs) wants machine-readable feedback.
        if (result.vendor_closed === true) {
          const names: string[] = Array.isArray(result.closedVendorNames)
            ? result.closedVendorNames.filter((n: unknown): n is string => typeof n === "string")
            : [];
          const detail =
            names.length > 0
              ? ` — ${names.join("، ")}`
              : "";
          showToast(
            (result.error || "بعض المتاجر مغلقة حالياً") + detail,
            "error",
          );
          idempotencyKeyRef.current = null;
          return { kind: "error" };
        }
        showToast(
          result.error || result.message || "حدث خطأ أثناء إنشاء الطلب",
          "error",
        );
        // Rotate the idempotency key so a retry can succeed — otherwise
        // the route would return the same failed lookup.
        idempotencyKeyRef.current = null;
        return { kind: "error" };
      }

      // Online payments branch two ways:
      //  • `payment_url` set → server opened a Moyasar hosted invoice
      //    (no publishable key configured). Full-page redirect to it.
      //  • `inline_payment: true` → publishable key configured, so the
      //    server skipped invoice creation. We must render the inline
      //    Moyasar form here to actually collect payment, otherwise the
      //    order stays `payment_status='pending'` forever.
      // Cash / wallet → no payment step, success page directly.
      const paymentUrl: string | undefined =
        typeof result.payment_url === "string" && result.payment_url.length > 0
          ? result.payment_url
          : undefined;
      const orderIdStr = String(
        result.parent_order_id ?? result.orderId ?? result.order_id ?? "",
      );
      const totalVal = Number(result.total ?? 0);

      if (paymentUrl) {
        // Use window.location so we leave the SPA — Moyasar expects a
        // full navigation. The success_url on the invoice will bring the
        // customer back to /checkout/success once the gateway fires.
        clearCart();
        return {
          kind: "hosted_redirect",
          paymentUrl,
          orderId: orderIdStr,
        };
      }
      if (
        result.inline_payment === true &&
        isInlineMoyasarMethod(selectedPayment)
      ) {
        // Inline Moyasar — render the form on THIS page. /checkout/pay
        // remains as a deep-link fallback for direct nav, but the primary
        // flow keeps the customer on the checkout page.
        setPayError(null);
        setInlineOrder({
          orderId: orderIdStr,
          totalSar: totalVal,
          method: selectedPayment as CheckoutMoyasarMethod,
        });
        // The auto-effect doesn't need to scroll — the form mounts in
        // place. The manual flow scrolls after this returns.
        if (source === "manual") {
          requestAnimationFrame(() => {
            sectionRefs.payment.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          });
        }
        return {
          kind: "inline_mounted",
          orderId: orderIdStr,
          total: totalVal,
        };
      }
      // Tamara returns a hosted `payment_url` (handled above), so if we
      // reach this branch it means the server couldn't open the hosted
      // session — surface the error and skip the success path. Cash /
      // bank_transfer / wallet all take the success_no_payment branch
      // since none of them require a payment gateway (admin confirms
      // bank transfers manually; cash and wallet collect on delivery).
      clearCart();
      return { kind: "success_no_payment", orderId: orderIdStr };
    } catch (error) {
      showToast("حدث خطأ، يرجى المحاولة مرة أخرى", "error");
      // On error, regenerate the idempotency key so a manual retry isn't
      // silently deduped into the failed attempt.
      idempotencyKeyRef.current = null;
      return { kind: "error" };
    }
  };

  const handlePlaceOrder = async () => {
    // Validate at submit time. If anything is missing, mark the
    // invalid sections, smooth-scroll to the first one, and stop —
    // do NOT post until the user has provided a valid address and
    // selected a payment method.
    if (addressInvalid || paymentInvalid) {
      setShowValidation(true);
      const target = addressInvalid ? sectionRefs.address.current : sectionRefs.payment.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(
        addressInvalid
          ? "يرجى اختيار عنوان التوصيل قبل المتابعة"
          : "يرجى اختيار طريقة الدفع",
        "error",
      );
      return;
    }

    if (!isPickup && !selectedAddress) return;

    // SECURITY (Pay-Dup): synchronous ref-based lock. `disabled` on the
    // button relies on React state, which is asynchronous — between the
    // user's first click and the next render, additional clicks can
    // still register and produce duplicate orders + duplicate Moyasar
    // invoices. The ref updates synchronously inside the same event
    // loop tick, so the second click returns early before any async work.
    if (submittingRef.current) return;
    submittingRef.current = true;

    setIsProcessing(true);

    // Delegate to the shared helper. For online methods the helper
    // mounts the inline form (or redirects to a hosted invoice); for
    // cash it returns `success_no_payment` and we navigate to the
    // success page. The auto-create effect uses the same helper, so
    // the validation / CSRF / idempotency logic stays in one place.
    const outcome = await createOrder({ source: "manual" });

    submittingRef.current = false;
    setIsProcessing(false);

    if (outcome.kind === "hosted_redirect") {
      window.location.href = outcome.paymentUrl;
      return;
    }
    if (outcome.kind === "success_no_payment") {
      router.push(`/checkout/success?order_id=${outcome.orderId}`);
      return;
    }
    if (outcome.kind === "inline_mounted") {
      // createOrder already scrolled the payment section into view.
      return;
    }
    // Failure: createOrder already showed the toast.
  };

  /**
   * Auto-mount the inline Moyasar form whenever an online payment
   * method is picked AND a delivery address is chosen (or pickup).
   * First time these conditions line up we POST /api/v1/checkout so
   * the server creates the parent order; on success the form appears
   * immediately. Cash still requires the explicit "تأكيد الطلب" tap.
   */
  useEffect(() => {
    // Operator decision (2026-09-20): online methods (mada/visa/mc/amex/
    // apple_pay) auto-create the order and mount the inline Moyasar
    // form. Wallet and bank_transfer short-circuit here — the user
    // must tap "تأكيد الطلب" explicitly so the server creates the
    // order with the canonical idempotency key and the customer can
    // review the bank-transfer card before submitting.
    const online =
      selectedPayment === "mada" ||
      selectedPayment === "visa" ||
      selectedPayment === "mastercard" ||
      selectedPayment === "amex" ||
      selectedPayment === "apple_pay";
    if (!online) return;
    if (items.length === 0) return;
    if (!isPickup && !selectedAddress) return;
    if (submittingRef.current) return;

    // Switched payment method on an EXISTING order — just update the
    // row's payment_method column via PATCH. Don't POST /checkout again,
    // or we'd create a duplicate order every time the user toggles
    // mada ↔ visa ↔ tamara.
    if (inlineOrder && inlineOrder.method !== selectedPayment) {
      const targetMethod = selectedPayment as CheckoutMoyasarMethod;
      const orderId = inlineOrder.orderId;
      void (async () => {
        try {
          const res = await csrfFetch(
            `/api/v1/orders/${orderId}/payment-method`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payment_method: targetMethod,
                // Required for guest ownership check on the server.
                idempotency_key: idempotencyKeyRef.current ?? undefined,
              }),
            },
          );
          const data = await res.json();
          if (!res.ok || !data?.success) {
            showToast(
              data?.error || "تعذّر تحديث طريقة الدفع",
              "error",
            );
            return;
          }
          // Re-mount the inline form for the new method.
          setInlineOrder({
            orderId,
            totalSar: inlineOrder.totalSar,
            method: targetMethod,
          });
          setPayError(null);
        } catch {
          showToast("تعذّر تحديث طريقة الدفع. حاول مرة أخرى", "error");
        }
      })();
      return;
    }

    // Already showing the inline form for this exact method — nothing to do.
    if (inlineOrder) return;

    submittingRef.current = true;
    setIsProcessing(true);
    void (async () => {
      const outcome = await createOrder({ source: "auto" });
      submittingRef.current = false;
      setIsProcessing(false);
      if (outcome.kind === "hosted_redirect") {
        window.location.href = outcome.paymentUrl;
      }
    })();
    // createOrder closure captures latest state via React state setters
    // (stable), so we intentionally don't list it as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPayment, selectedAddress, isPickup, items.length]);

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) return;
    setIsApplyingCoupon(true);
    setCouponResult(null);
    try {
      // csrfFetch attaches the x-csrf-token header required by the proxy
      // double-submit cookie gate. Even though /api/v1/coupons/validate
      // is currently CSRF-exempt, going through csrfFetch keeps every
      // client mutator on a single path.
      const res = await csrfFetch("/api/v1/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal }),
      });
      const data = await res.json();
      if (data?.success && data.valid) {
        setCouponResult({
          valid: true,
          discount: Number(data.discount ?? 0),
          type: data.type,
          message: data.message,
          code: data.code,
        });
      } else {
        setCouponResult({
          valid: false,
          message: data?.error || "كود الخصم غير صحيح",
        });
      }
    } catch {
      setCouponResult({
        valid: false,
        message: "تعذّر التحقق من الكوبون. حاول مرة أخرى.",
      });
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setCouponResult(null);
    setCouponCode("");
  };

  // Address deletion — opens a confirmation dialog before issuing the
  // DELETE /api/v1/addresses?id=… call. The id is required by the route
  // and the row is removed from the cascading user_id check, so any
  // address owned by the authenticated user can be deleted from here.
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);
  const [confirmDeleteAddress, setConfirmDeleteAddress] =
    useState<Address | null>(null);

  const handleDeleteAddress = async (addr: Address) => {
    setConfirmDeleteAddress(null);
    setDeletingAddressId(addr.id);
    try {
      const r = await csrfFetch(
        `/api/v1/addresses?id=${encodeURIComponent(addr.id)}`,
        { method: "DELETE" },
      );
      const data = await r.json().catch(() => ({ success: false }));
      if (!r.ok || !data.success) {
        showToast(data?.error || "تعذّر حذف العنوان. حاول مرة أخرى.", "error");
        return;
      }
      // Drop the row from local state and reset the selection if the
      // deleted address was the active one — otherwise the order POST
      // would carry a stale address_id.
      setAddresses((prev) => prev.filter((a) => a.id !== addr.id));
      if (selectedAddress?.id === addr.id) {
        setSelectedAddress(null);
      }
      showToast("تم حذف العنوان", "success");
    } catch {
      showToast("تعذّر الاتصال بخدمة العناوين. حاول مرة أخرى.", "error");
    } finally {
      setDeletingAddressId(null);
    }
  };

  // Inline Moyasar payment stays on /checkout/pay (a separate route
  // allowed by isStorefrontRoute). After order creation we navigate
  // there with orderId + total + method as query params. /checkout/success
  // and /checkout/error remain the only completion / failure paths.
  // Keeping the multi-screen flow here means the inline checkout-new
  // page never has to mount the Moyasar script twice (once for hosted
  // payment_url, once for inline_payment), and the two surfaces
  // share the same Chrome (HeaderV2 + BottomNavV2).

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-24 h-24 bg-primary-100 rounded-full flex items-center justify-center mb-4">
          <ShoppingCart className="w-12 h-12 text-primary-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">السلة فارغة</h1>
        <p className="text-gray-500 mb-4">يرجى إضافة منتجات للمتابعة</p>
        <Link href="/catalog" className="text-primary-600 font-medium">
          تصفح المنتجات
        </Link>
      </div>
    );
  }

  // `done` flags drive the chip colour on each section card so the
  // user can scan the page top-to-bottom and see what's still
  // outstanding. `showValidation` is the only thing that flips a
  // section to `invalid` — we don't want to scream "red border" at
  // the user before they've tried to submit.
  const addressDone = isPickup || !!selectedAddress;
  const paymentDone = !!selectedPayment;

  return (
    // Bottom padding clears the sticky action bar AND the global
    // BottomNavV2 (h-16 = 4rem). The action bar itself sits above the
    // bottom nav via `bottom: calc(4rem + env(safe-area-inset-bottom))`.
    <div className="min-h-screen bg-gray-50 pb-44">
      {/* Header (not sticky — the global HeaderV2 is the sticky top).
          The local title row carries the back-to-cart action only. */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Link
            href="/cart"
            className="p-2 -mr-2 hover:bg-gray-100 rounded-xl transition-colors"
            aria-label="العودة إلى السلة"
          >
            <ArrowLeft className="w-6 h-6 text-gray-600" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900 leading-tight">
              إتمام الطلب
            </h1>
            <p className="text-xs text-gray-500">
              {items.length} منتج · كامل العملية في صفحة واحدة
            </p>
          </div>
        </div>
      </div>

      {/* Body — single scrollable column. Each section is a card
          (`SectionCard`) so the layout stays consistent regardless of
          which fields are visible. We render all sections always; the
          user can review every choice without navigating between
          steps. Conditional sections (address when delivery) collapse
          inline so the column never has empty whitespace. */}
      <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
        {/* 01 — Delivery Mode */}
        <SectionCard
          index={1}
          icon={Truck}
          title="طريقة الاستلام"
          done={!!deliveryMode}
        >
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: "delivery", label: "توصيل للعنوان", icon: MapPin },
              { id: "pickup", label: "استلام من المتجر", icon: ShoppingCart },
            ] as const).map((mode) => {
              const Icon = mode.icon;
              const active = deliveryMode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    setDeliveryMode(mode.id);
                    // Pickup orders can't be scheduled — reset to express so
                    // a stale slot never ships with a pickup delivery type.
                    if (mode.id === "pickup") setSchedule({ mode: "express" });
                  }}
                  className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 ${
                    active
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                  aria-pressed={active}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium text-sm">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* 02 — Address (only when delivery) */}
        {!isPickup && (
          <div ref={sectionRefs.address}>
            <SectionCard
              index={2}
              icon={MapPin}
              title="عنوان التوصيل"
              done={addressDone}
              invalid={showValidation && addressInvalid}
            >
              {addresses.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">لا توجد عناوين محفوظة</p>
                    <button
                      type="button"
                      onClick={openSheet}
                      className="underline hover:no-underline"
                    >
                      أضف عنواناً جديداً
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map((addr) => {
                    const selected = selectedAddress?.id === addr.id;
                    const missingCoords = addr.lat == null || addr.lng == null;
                    const isDeleting = deletingAddressId === addr.id;
                    return (
                      <div key={addr.id} className="flex items-stretch gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedAddress(addr)}
                          className={`flex-1 min-w-0 p-3 rounded-2xl border-2 text-right transition-all ${
                            selected
                              ? "border-primary-600 bg-primary-50"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                          aria-pressed={selected}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                selected
                                  ? "bg-primary-600 text-white"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              <MapPin className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-900">
                                  {addr.label}
                                </span>
                                {addr.is_default && (
                                  <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs font-medium rounded-lg">
                                    افتراضي
                                  </span>
                                )}
                              </div>
                              {addressTextOf(addr) && (
                                <p className="text-sm text-gray-500 mt-1">
                                  {addressTextOf(addr)}
                                </p>
                              )}
                              {(addr.building || addr.description) && (
                                <p className="text-sm text-gray-500">
                                  {addr.building}
                                  {addr.floor ? ` - ${addr.floor}` : ""}
                                  {!addr.building && addr.description
                                    ? addr.description
                                    : ""}
                                </p>
                              )}
                              {missingCoords ? (
                                <p className="text-xs text-amber-600 mt-1">
                                  بدون إحداثيات — حدّث العنوان من صفحة العناوين
                                  لحساب رسوم التوصيل.
                                </p>
                              ) : null}
                            </div>
                            {selected && (
                              <Check className="w-5 h-5 text-primary-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAddress(addr)}
                          disabled={isDeleting}
                          aria-label={`حذف ${addr.label}`}
                          data-testid={`checkout-address-delete-${addr.id}`}
                          className="shrink-0 w-11 rounded-2xl border-2 border-gray-200 bg-white text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={openSheet}
                    className="w-full p-3 rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 hover:border-primary-500 hover:text-primary-600 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="font-medium text-sm">إضافة عنوان جديد</span>
                  </button>
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* 02.5 — Delivery Time (only when delivery + address picked) */}
        {!isPickup && addressDone && (
          <div ref={sectionRefs.schedule}>
            <SectionCard
              index={3}
              icon={Clock}
              title="وقت التوصيل"
              done
            >
              <DeliverySchedulePicker
                value={schedule}
                onChange={setSchedule}
                disabled={!selectedAddress}
              />
            </SectionCard>
          </div>
        )}

        {/* 03 — Payment Method */}
        <div ref={sectionRefs.payment}>
          <SectionCard
            index={isPickup ? 2 : (addressDone ? 4 : 3)}
            icon={CreditCard}
            title="طريقة الدفع"
            done={paymentDone}
            invalid={showValidation && paymentInvalid}
          >
            <div className="space-y-3">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                const selected = selectedPayment === method.id;
                return (
                  <button
                    key={method.id}
                    onClick={() => {
                      // Switching payment method mid-flow: drop the
                      // pending inline order so the auto-mount effect
                      // can create a fresh one with a new idempotency
                      // key. The previous order stays `payment_status:
                      // pending` in the DB; the customer can cancel
                      // from /orders if they decide not to pay.
                      // FIX: do NOT disable the button when an inline
                      // order is mounted — the user must be able to
                      // switch payment methods freely. The cleanup
                      // above already handles abandoning the previous
                      // pending order.
                      if (selectedPayment !== method.id) {
                        setInlineOrder(null);
                        setPayError(null);
                        idempotencyKeyRef.current = null;
                      }
                      setSelectedPayment(method.id);
                    }}
                    className={`w-full p-3 rounded-2xl border-2 text-right transition-all ${
                      selected
                        ? "border-primary-600 bg-primary-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ${
                          selected ? "bg-white" : "bg-gray-50"
                        }`}
                      >
                        {method.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={method.src}
                            alt={method.name}
                            width={32}
                            height={32}
                            className="w-8 h-8 object-contain"
                          />
                        ) : (
                          <div
                            className={`w-full h-full flex items-center justify-center ${
                              selected
                                ? "bg-primary-600 text-white"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            <Icon />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-gray-900 block">
                          {method.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {method.description}
                        </span>
                      </div>
                      {selected && (
                        <Check className="w-5 h-5 text-primary-600 flex-shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bank-transfer IBAN card surfaces the canonical Al Rajhi
                account when the customer picks "تحويل بنكي". Hidden for
                all other methods so it doesn't visually leak on the
                card / wallet screens. */}
            {isBankTransferSelected ? <BankTransferCard /> : null}

            {/* Inline Moyasar form — mounts in-place once the order is
                created with an online payment method. Renders card /
                mada / Apple Pay / STC Pay fields right here so the user
                stays on the checkout page through the entire flow. The
                form loads the publishable key + Apple Pay config from
                /api/v1/payments/moyasar/config internally. */}
            {inlineOrder && inlineMethod ? (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-gray-800">
                      الدفع الآمن عبر ميسر
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-500 font-mono" dir="ltr">
                    #{inlineOrder.orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}
                  </span>
                </div>
                {payError ? (
                  <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{payError}</span>
                  </div>
                ) : null}
                <MoyasarCheckoutForm
                  orderId={inlineOrder.orderId}
                  totalSar={inlineOrder.totalSar}
                  paymentMethod={inlineOrder.method}
                  onPaid={() => {
                    clearCart();
                    router.push(
                      `/checkout/success?order_id=${encodeURIComponent(
                        inlineOrder.orderId,
                      )}`,
                    );
                  }}
                  onError={(msg) => setPayError(msg)}
                />
                <button
                  type="button"
                  onClick={() => {
                    // Let the user back out to pick a different method
                    // without leaving the page. The order stays pending
                    // until payment — it can be cancelled from /orders.
                    setInlineOrder(null);
                    setPayError(null);
                  }}
                  className="mt-3 w-full text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
                >
                  العودة لاختيار طريقة دفع أخرى
                </button>
              </div>
            ) : null}
          </SectionCard>
        </div>

        {/* 04 — Coupon (optional) */}
        <SectionCard
          index={isPickup ? 3 : 4}
          icon={Tag}
          title="كود الخصم"
          done={!!couponResult?.valid}
        >
          {couponResult?.valid ? (
            <div className="flex items-center justify-between p-3 bg-primary-50 rounded-xl border border-primary-200">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold text-primary-700">
                    {couponResult.code ?? couponCode}
                  </p>
                  <p className="text-sm text-primary-600">
                    {couponResult.message}
                  </p>
                </div>
              </div>
              <button
                onClick={removeCoupon}
                className="text-xs text-primary-700 hover:underline"
                aria-label="إزالة الكوبون"
              >
                إزالة
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="أدخل كود الخصم"
                className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-[#009345]/20 transition-all"
                aria-label="كود الخصم"
              />
              <button
                onClick={applyCoupon}
                disabled={isApplyingCoupon || !couponCode.trim()}
                className="px-4 h-11 bg-primary text-white rounded-xl font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isApplyingCoupon ? "..." : "تطبيق"}
              </button>
            </div>
          )}
          {couponResult && !couponResult.valid && (
            <div className="flex items-center gap-2 mt-2 text-red-500 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{couponResult.message}</span>
            </div>
          )}

          {/* Phase 1 / T6: surface active coupons below the input so the
              customer can apply with one tap instead of guessing codes. */}
          <AvailableCoupons
            variant="inline"
            onApply={(code) => {
              setCouponCode(code);
              void applyCoupon();
            }}
            appliedCodes={
              couponResult?.valid && couponResult.code ? [couponResult.code] : []
            }
          />
        </SectionCard>

        {/* 05 — Order Summary */}
        <SectionCard
          index={isPickup ? 4 : 5}
          icon={Receipt}
          title="ملخص الطلب"
          done
        >
          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {items.map((item, index) => (
              <div
                key={`${item.product.id}-${index}`}
                className="flex items-center gap-3"
              >
                <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                  <Image
                    src={item.product.image_url || "https://cdn.citymarkets.sa/products/placeholder.svg"}
                    alt={item.product.name_ar}
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 line-clamp-1 text-sm">
                    {item.product.name_ar}
                  </p>
                  <p className="text-xs text-gray-500">الكمية: {item.quantity}</p>
                </div>
                <span className="font-semibold text-primary-600 text-sm whitespace-nowrap">
                  {((item.product.discount_price ?? item.product.price) * item.quantity).toFixed(2)} ر.س
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* 06 — Cost Breakdown (collapsed detail; total stays visible
            in the sticky bar). The detailed lines are kept so the
            customer can review before tapping "تأكيد الطلب" — the
            sticky bar is the at-a-glance view, this is the receipt. */}
        <SectionCard
          index={isPickup ? 5 : 6}
          icon={ChevronDown}
          title="تفاصيل التكلفة"
          done
        >
          <div className="space-y-2 text-sm">
            {schedule.mode === "scheduled" ? (
              // Audit 2026-09-30 (Finding 8.1): confirm the chosen slot
              // right above the CTA so the user can spot a wrong pick
              // before tapping "تأكيد الطلب". The picker already
              // provides `label_ar` + `date`, no extra fetch needed.
              <div className="flex justify-between items-center bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <span className="text-gray-600 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  موعد التوصيل
                </span>
                <span className="font-medium text-amber-900 text-xs">
                  {schedule.date} · {schedule.label_ar}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span className="text-gray-500">إجمالي المنتجات</span>
              <span className="font-medium">{subtotal.toFixed(2)} ر.س</span>
            </div>
            {!isPickup && (
              <div className="flex justify-between">
                <span className="text-gray-500">رسوم التوصيل</span>
                <span className="font-medium">
                  {deliveryFee > 0 ? `${deliveryFee.toFixed(2)} ر.س` : "مجاناً"}
                </span>
              </div>
            )}
            {serviceFee > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">رسوم الخدمة</span>
                <span className="font-medium">{serviceFee.toFixed(2)} ر.س</span>
              </div>
            )}
            {tax > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">ضريبة القيمة المضافة</span>
                <span className="font-medium">{tax.toFixed(2)} ر.س</span>
              </div>
            )}
            {couponDiscount > 0 && (
              <div className="flex justify-between text-primary-600">
                <span>خصم الكوبون</span>
                <span className="font-medium">
                  -{couponDiscount.toFixed(2)} ر.س
                </span>
              </div>
            )}
            <div className="border-t border-gray-100 pt-2 mt-2 flex justify-between items-center">
              <span className="font-semibold text-gray-900">الإجمالي</span>
              <span className="font-bold text-primary-600 text-lg">
                {total.toFixed(2)} ر.س
              </span>
            </div>
          </div>
        </SectionCard>

        {/* Trust badges — last in the column so they sit just above
            the sticky CTA. Drives the same "دفع آمن / توصيل / دعم"
            reassurance the cart page ends with. */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { icon: Truck, label: "توصيل خلال 45 دقيقة" },
            { icon: Shield, label: "دفع آمن 100%" },
            { icon: Clock, label: "دعم 24/7" },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={i}
                className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl text-center"
              >
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-xs text-gray-600">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky Bottom Bar — single CTA. The user earns "تأكيد الطلب"
          by filling the address + payment sections; the bar shows the
          running total + a compact place-order button. Sits ABOVE the
          global BottomNavV2 (h-16 = 4rem) so the storefront nav stays
          visible during checkout. Tapping the button either posts the
          order (cash / wallet → /checkout/success) or mounts the
          inline Moyasar form for online methods. When the inline form
          is showing we collapse the bottom bar to just the total so
          it doesn't shadow the form's own pay button. Validation
          errors surface here as a subtitle, not a modal. */}
      <div
        className="fixed left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-2xl safe-bottom"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
        role="region"
        aria-label="ملخص الدفع"
      >
        <div className="px-4 py-3 max-w-2xl mx-auto">
          {inlineOrder ? (
            <div className="flex items-center justify-between">
              <div
                className="flex flex-col leading-tight min-w-0"
                aria-label={`الإجمالي ${inlineOrder.totalSar.toFixed(2)} ريال`}
              >
                <span className="text-[11px] text-gray-500">الإجمالي</span>
                <span className="font-bold text-primary-600 text-base whitespace-nowrap">
                  {inlineOrder.totalSar.toFixed(2)} ر.س
                </span>
              </div>
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-primary" />
                أدخل بيانات الدفع في النموذج بالأعلى
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className="flex flex-col leading-tight min-w-0"
                aria-label={`الإجمالي ${total.toFixed(2)} ريال`}
              >
                <span className="text-[11px] text-gray-500 flex items-center gap-1">
                  <span>الإجمالي</span>
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/10 text-primary-700 text-[10px] font-bold"
                    aria-label={`${items.length} منتجات`}
                  >
                    {items.length > 99 ? "99+" : items.length}
                  </span>
                </span>
                <span className="font-bold text-primary-600 text-base whitespace-nowrap">
                  {total.toFixed(2)} ر.س
                </span>
              </div>
              <button
                onClick={handlePlaceOrder}
                disabled={isProcessing}
                className="flex-1 py-3 bg-gradient-to-l from-[#009345] to-[#00B359] text-white rounded-2xl font-semibold hover:shadow-lg hover:shadow-[#009345]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#009345] focus-visible:ring-offset-2"
                aria-label={isProcessing ? "جاري إنشاء الطلب" : "تأكيد الطلب"}
              >
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري إنشاء الطلب...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    <span>تأكيد الطلب</span>
                  </>
                )}
              </button>
            </div>
          )}
          {showValidation && (addressInvalid || paymentInvalid) && !inlineOrder ? (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>
                {addressInvalid
                  ? "اختر عنواناً للتوصيل وأكمل بقية البيانات"
                  : "اختر طريقة دفع للمتابعة"}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Confirm-delete dialog for the address. Mirrors the pattern in
          /profile/addresses: a single modal with cancel + confirm, and
          the actual DELETE call only fires on confirm. Cancelling keeps
          the row untouched; confirming optimistically removes the row
          from local state on a 2xx response. */}
      {confirmDeleteAddress ? (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-confirm-delete-title"
          onClick={() => setConfirmDeleteAddress(null)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-3xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h2
                id="checkout-confirm-delete-title"
                className="text-lg font-bold text-gray-900"
              >
                حذف العنوان؟
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              {confirmDeleteAddress.label}
            </p>
            {addressTextOf(confirmDeleteAddress) ? (
              <p className="text-sm text-gray-500 mb-5">
                {addressTextOf(confirmDeleteAddress)}
              </p>
            ) : (
              <div className="mb-5" />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteAddress(null)}
                className="flex-1 py-2.5 rounded-xl text-gray-700 font-semibold hover:bg-gray-100"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAddress(confirmDeleteAddress)}
                className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-red-600 hover:bg-red-700"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
