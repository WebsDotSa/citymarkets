/**
 * Canonical payment-method registry for city-market-app.
 *
 * The values mirror the `vendor_orders.payment_method` CHECK constraint
 * (see `migrations/038_multi_vendor_checkout.sql` and
 *  `migrations/056_payment_methods_bank_transfer.sql`).
 *
 * `cash`, `stc_pay`, `tamara`, and `cod` are intentionally absent from the
 * customer-facing list — the operator removed these on 2026-09-20 and
 * asks customers to pay electronically (mada/visa/mc/amex/apple_pay/wallet)
 * or via manual bank transfer (bank_transfer).
 */

export const BANK_TRANSFER_DETAILS = {
  bank_name: 'مصرف الراجحي',
  account_name: 'مؤسسة اسواق سيتي المركزية للمواد الغذائية',
  account_iban: 'SA9580000422608016336661',
} as const;

export type PaymentMethodId =
  | 'mada'
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'apple_pay'
  | 'wallet'
  | 'bank_transfer';

export interface PaymentMethodUi {
  id: PaymentMethodId;
  name: string;
  icon: string;
  src?: string;
  description: string;
  details?: typeof BANK_TRANSFER_DETAILS;
}

/**
 * Customer-facing payment methods shown in the checkout picker. Order is
 * presentation order (electronic cards first, then wallet, then bank
 * transfer last because it requires manual confirmation).
 */
export const PAYMENT_METHODS_UI: PaymentMethodUi[] = [
  {
    id: 'mada',
    name: 'بطاقة مدى',
    icon: 'CardIcon',
    src: '/images/partners/mada.svg',
    description: 'ادفع ببطاقة مدى بسهولة وأمان',
  },
  {
    id: 'visa',
    name: 'Visa',
    icon: 'VisaIcon',
    src: '/images/partners/visa-circle.svg',
    description: 'ادفع ببطاقة فيزا',
  },
  {
    id: 'mastercard',
    name: 'Mastercard',
    icon: 'MastercardIcon',
    src: '/images/partners/mastercard-circle.svg',
    description: 'ادفع ببطاقة ماستركارد',
  },
  {
    id: 'amex',
    name: 'American Express',
    icon: 'AmexIcon',
    description: 'ادفع ببطاقة أمريكان إكسبريس',
  },
  {
    id: 'apple_pay',
    name: 'Apple Pay',
    icon: 'ApplePayIcon',
    src: '/images/partners/apple_pay.svg',
    description: 'ادفع بسرعة بأبل باي',
  },
  {
    id: 'wallet',
    name: 'المحفظة',
    icon: 'WalletIcon',
    description: 'ادفع من رصيد محفظتك',
  },
  {
    id: 'bank_transfer',
    name: 'تحويل بنكي',
    icon: 'BankIcon',
    description: 'حوّل المبلغ على حساب الراجحي وأرفق الإيصال',
    details: BANK_TRANSFER_DETAILS,
  },
];

/**
 * Methods that should bypass the inline Moyasar form (i.e. require no
 * card capture in checkout and no payment URL).
 *
 * `cash` and `wallet` are also manual because no gateway integration is
 * involved — the user pays the driver / has their balance debited server-
 * side at confirm time. `bank_transfer` is manual because the customer
 * must upload a receipt and admin must confirm the deposit.
 *
 * Note: `DISABLED_METHODS` (the customer-facing picker deny-list for
 * legacy tokens like `cash` / `tamara` / `stc_pay`) was removed on
 * 2026-09-30 (P3-3 audit). The picker now rejects these tokens by
 * virtue of NOT being in `PaymentMethodId` / `PAYMENT_METHODS_UI`, so
 * the deny-list was redundant.
 */
export const NON_ELECTRONIC_METHODS: ReadonlySet<string> = new Set([
  'cash',
  'wallet',
  'bank_transfer',
  '',
]);

/**
 * Methods the order creation / update API accepts as `payment_method`.
 * Mirrors the `ALLOWED_METHODS` set in
 * `src/app/api/v1/orders/[id]/payment-method/route.ts`.
 */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'mada',
  'visa',
  'mastercard',
  'amex',
  'apple_pay',
  'wallet',
  'bank_transfer',
]);

/**
 * The subset of `PaymentMethodId` that the customer-facing "pay / retry"
 * CTA can initiate via the online checkout or payment-retry endpoint.
 *
 * Operator decision (2026-09-20): stc_pay removed from the retry picker.
 * `bank_transfer` is intentionally absent — manual bank transfers are not
 * retryable via this endpoint; the customer must re-confirm through admin.
 * `tamara` is a BNPL choice made at checkout, not a retryable method.
 *
 * Canonical source for membership. Exported as both:
 *   - `ONLINE_RETRY_METHODS` (const tuple) for code that wants the literal
 *     union narrowed (e.g. `(typeof ONLINE_RETRY_METHODS)[number]`).
 *   - `ONLINE_RETRY_METHODS_SET` for code that wants `O(1)` `.has()` checks.
 *
 * Replaces the four previously-inline copies:
 *   - src/lib/orders/order-payment-action.ts (ONLINE_RETRYABLE_METHODS alias)
 *   - src/lib/payments/payment-service.ts (ONLINE_RETRY_METHODS alias)
 *   - src/components/pages/checkout/checkout-new.tsx (INLINE_MOYASAR_METHODS)
 *   - src/components/pages/orders/order-payment-action.tsx (removed)
 *
 * D16-D19 cleanup (2026-09-30): both legacy aliases
 * (`ONLINE_RETRY_METHODS` in payment-service and `ONLINE_RETRYABLE_METHODS`
 * in order-payment-action / @/lib/orders barrel) were deleted. Callers
 * now import `ONLINE_RETRY_METHODS_SET` (or the tuple) directly from
 * this file.
 */
export const ONLINE_RETRY_METHODS = [
  'mada',
  'visa',
  'mastercard',
  'amex',
  'apple_pay',
] as const satisfies readonly PaymentMethodId[];

export const ONLINE_RETRY_METHODS_SET: ReadonlySet<string> = new Set(
  ONLINE_RETRY_METHODS,
);

/**
 * The full canonical payment-method tuple — every member of `PaymentMethodId`.
 * Exported as a runtime tuple so validation schemas can derive from a single
 * source of truth (audit S6). Mirrors `PaymentMethodId` exactly.
 */
export const ALL_PAYMENT_METHODS = [
  'mada',
  'visa',
  'mastercard',
  'amex',
  'apple_pay',
  'wallet',
  'bank_transfer',
] as const satisfies readonly PaymentMethodId[];

/**
 * Set form of `ALL_PAYMENT_METHODS` for O(1) `.has()` lookups in
 * `resolvePaymentMethod` and any other hot path that needs to ask
 * "is this string already canonical?".
 */
export const ALL_PAYMENT_METHODS_SET: ReadonlySet<string> = new Set(ALL_PAYMENT_METHODS);

/**
 * Legacy payment-method tokens that were removed from the customer-facing
 * picker on 2026-09-20 but still appear in:
 *
 *   - historical `orders.payment_method` / `vendor_orders.payment_method`
 *     rows from before the operator migration (the analytics layer groups
 *     them by these buckets);
 *   - the `createOrderSchema` validator (legacy `POST /api/v1/orders` path
 *     was deprecated on 2026-09-30 → use `POST /api/v1/checkout`).
 *     `createOrderSchema` itself is still imported elsewhere as a
 *     shared shape; the legacy POST handler now returns 410 Gone.
 *   - admin-side analytics / reporting endpoints that read these tokens
 *     out of the DB and re-validate them before display.
 *
 * `paymentMethodSchema` in `validation/schemas.ts` derives from this tuple
 * unioned with `ALL_PAYMENT_METHODS`. Do NOT add a token here without
 * verifying that (a) existing DB rows can still be read back into the
 * enum, and (b) the customer-facing picker still rejects it by NOT being
 * in the `PaymentMethodId` union / `PAYMENT_METHODS_UI` catalogue so a
 * stale client can't downgrade the UX.
 */
export const LEGACY_PAYMENT_METHODS = [
  'cash',
  'card',
  'moyasar',
  'stc_pay',
  'tamara',
] as const;

/**
 * Legacy → canonical alias map. Pre-2026-09-20 clients (and any in-flight
 * builds still using the old picker) POST strings that the canonical
 * `ALLOWED_METHODS` set does NOT include. Without translation, those
 * values land in `orders.payment_method` unchanged and break the
 * revenue/SQL filters in `analytics-queries.ts` (`isElectronicPaymentMethod`
 * and friends) — every legacy-string order is counted as "non-electronic"
 * even when it was an electronic Moyasar charge.
 *
 * Apply this map at the **boundary** (the route handler, before INSERT)
 * and NEVER inside SQL filters. The canonical set stays the only set
 * stored in the DB from now on; existing legacy rows are read-only.
 *
 * P0-3 fix (full-system audit 2026-09-30):
 *   - `cash`         → `wallet`     (manual, debited at confirm time)
 *   - `card`         → `mada`       (degenerate to the dominant card brand)
 *   - `moyasar`      → `mada`       (Moyasar card without brand hint)
 *   - `moyasar_card` → `mada`       (alias already canonicalised upstream)
 *   - `moyasar_applepay` → `apple_pay`
 *   - `stc_pay`      → `bank_transfer` (no STC Pay integration; manual reconfirm)
 *   - `tamara`       → `bank_transfer` (BNPL was removed 2026-09-20)
 *   - `applepay`     → `apple_pay`  (typo / missing underscore)
 *   - `stcpay`       → `bank_transfer`
 *   - `cod`          → `wallet`     (drivers collect, debited on delivery)
 *   - `cash_on_delivery` → `wallet`
 *   - `master_card`  → `mastercard` (typo / missing 'd')
 *
 * Unknown legacy strings throw via `assertKnownPaymentMethod` so the
 * caller fails loudly instead of silently writing garbage into the DB.
 */
export const PAYMENT_METHOD_ALIAS_MAP: Readonly<Record<string, PaymentMethodId>> = {
  cash: 'wallet',
  card: 'mada',
  moyasar: 'mada',
  moyasar_card: 'mada',
  moyasar_applepay: 'apple_pay',
  stc_pay: 'bank_transfer',
  stcpay: 'bank_transfer',
  tamara: 'bank_transfer',
  applepay: 'apple_pay',
  cod: 'wallet',
  cash_on_delivery: 'wallet',
  master_card: 'mastercard',
};

/**
 * Resolve a payment-method string to its canonical `PaymentMethodId`.
 * If the input is already canonical, it is returned as-is. If it's a
 * known legacy alias, it's translated via `PAYMENT_METHOD_ALIAS_MAP`.
 * Otherwise we throw — silent fallback would let arbitrary strings
 * reach `orders.payment_method` and break every analytics filter.
 */
export function resolvePaymentMethod(raw: string | null | undefined): PaymentMethodId {
  if (!raw) return 'wallet';
  if (ALL_PAYMENT_METHODS_SET.has(raw)) return raw as PaymentMethodId;
  const aliased = PAYMENT_METHOD_ALIAS_MAP[raw];
  if (aliased) return aliased;
  throw new Error(`Unknown payment_method: ${JSON.stringify(raw)}`);
}