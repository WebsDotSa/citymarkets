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
 * `wallet` is also manual because the user's balance is debited server-side
 * at confirm time.
 */
export const NON_ELECTRONIC_METHODS: ReadonlySet<string> = new Set([
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