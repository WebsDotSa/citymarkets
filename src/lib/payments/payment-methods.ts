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
 * Methods that must NEVER appear in the customer-facing picker.
 * Kept as a set so future re-enabling is a one-line edit.
 */
export const DISABLED_METHODS: ReadonlySet<string> = new Set([
  'cash',
  'stc_pay',
  'tamara',
  'cod',
  'moyasar_card',
  'moyasar_applepay',
  'card',
  'applepay',
  'stcpay',
]);

/**
 * Methods that should bypass the inline Moyasar form (i.e. require no
 * card capture in checkout and no payment URL).
 *
 * `cash` and `wallet` are also manual because no gateway integration is
 * involved — the user pays the driver / has their balance debited server-
 * side at confirm time. `bank_transfer` is manual because the customer
 * must upload a receipt and admin must confirm the deposit.
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
 *   - src/lib/orders/order-payment-action.ts:39         (ONLINE_RETRYABLE_METHODS)
 *   - src/lib/payments/payment-service.ts:51            (ONLINE_RETRY_METHODS)
 *   - src/components/pages/checkout/checkout-new.tsx:78 (INLINE_MOYASAR_METHODS)
 *   - src/components/pages/orders/order-payment-action.tsx (METHOD_OPTIONS subset)
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
 * Legacy payment-method tokens that were removed from the customer-facing
 * picker on 2026-09-20 but still appear in:
 *
 *   - historical `orders.payment_method` / `vendor_orders.payment_method`
 *     rows from before the operator migration (the analytics layer groups
 *     them by these buckets);
 *   - the `createOrderSchema` validator (legacy `POST /api/v1/orders` path
 *     still accepts `tamara`/`stc_pay`/`cash`/`card`/`moyasar` because
 *     in-flight client builds may POST them);
 *   - admin-side analytics / reporting endpoints that read these tokens
 *     out of the DB and re-validate them before display.
 *
 * `paymentMethodSchema` in `validation/common.ts` derives from this tuple
 * unioned with `ALL_PAYMENT_METHODS`. Do NOT add a token here without
 * verifying that (a) existing DB rows can still be read back into the
 * enum, and (b) the customer-facing picker still rejects it via
 * `DISABLED_METHODS` so a stale client can't downgrade the UX.
 */
export const LEGACY_PAYMENT_METHODS = [
  'cash',
  'card',
  'moyasar',
  'stc_pay',
  'tamara',
] as const;