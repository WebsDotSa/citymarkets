/**
 * Inline SVG icons used by the payment UI surfaces (checkout, cart
 * summary, payment-method pickers). Kept as inline SVGs so they're
 * tree-shakable and render before any icon-font font-load flicker.
 */
import * as React from "react";

const baseProps = {
  viewBox: "0 0 24 24",
  className: "w-6 h-6",
} as const;

export function CashIcon() {
  return (
    <svg {...baseProps} fill="none">
      <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="2" />
      <path d="M6 12h.01M18 12h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CardIcon() {
  return (
    <svg {...baseProps} fill="none">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function ApplePayIcon() {
  return (
    <svg {...baseProps} fill="currentColor">
      <path d="M17.05 12.54c-.03-2.14 1.75-3.18 1.83-3.22-.99-1.46-2.54-1.65-3.09-1.67-1.3-.13-2.54.77-3.21.77-.67 0-1.7-.75-2.81-.73-1.45.02-2.78.85-3.52 2.14-1.5 2.62-.38 6.47 1.07 8.57.72 1.03 1.57 2.19 2.69 2.15 1.08-.04 1.49-.69 2.8-.69 1.3 0 1.66.69 2.8.67 1.17-.02 1.91-.83 2.61-1.67.82-.96 1.16-1.89 1.18-1.94-.03-.02-2.25-.87-2.27-3.44-.01-2.02 1.83-2.99 1.92-3.03zm-3.32-6.6c.58-1.03 1.4-2.11 2.38-2.11.13 0 .25 0 .37.02-1.43-.51-3.01.83-3.67 1.94.04.02.65.13.92.15z" />
    </svg>
  );
}

export function STCPayIcon() {
  return (
    <svg {...baseProps} fill="currentColor">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function VisaIcon() {
  return (
    <svg {...baseProps} fill="currentColor">
      <path d="M19.5 6h-15A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h15a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 19.5 6zm-9.36 8.7H8.42l-1.5-5.4a.75.75 0 0 0-.42-.51l-.18-.06.06-.18h2.46a.66.66 0 0 1 .66.57l.78 3.75 1.95-4.32h1.92l-3 6.15zm5.34 0h-1.92l1.05-6.15h1.92l-1.05 6.15zm4.95-4.62-.36 1.95h-2.13l.36-1.95h2.13zm-.69 3.81c-.27.66-.99 1.05-1.74 1.05-.81 0-1.5-.39-1.5-1.05 0-1.05 1.05-1.41 2.04-1.5h.81c0 .51-.18 1.05-.6 1.5z" />
    </svg>
  );
}

export function MastercardIcon() {
  return (
    <svg {...baseProps} fill="currentColor">
      <circle cx="9" cy="12" r="5" fill="#EB001B" />
      <circle cx="15" cy="12" r="5" fill="#F79E1B" />
      <path d="M12 8.5a4.99 4.99 0 0 1 1.85 3.5A4.99 4.99 0 0 1 12 15.5a4.99 4.99 0 0 1-1.85-3.5A4.99 4.99 0 0 1 12 8.5z" fill="#FF5F00" />
    </svg>
  );
}

export function AmexIcon() {
  return (
    <svg {...baseProps} fill="currentColor">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <text x="12" y="14.5" textAnchor="middle" fontSize="6" fontWeight="bold" fontFamily="sans-serif">AMEX</text>
    </svg>
  );
}

export function WalletIcon() {
  return (
    <svg {...baseProps} fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="17" cy="14" r="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Tamara — BNPL (Buy Now Pay Later). أيقونة علامة تجارية مبسّطة:
 * حرف "T" داخل دائرة بألوان تمارا (وردي/أرجواني). تُعرَض مع بقية
 * طرق الدفع في واجهة checkout.
 */
export function TamaraIcon() {
  return (
    <svg {...baseProps} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" fill="currentColor" />
      <path
        d="M11 10.5h10M16 10.5v11"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Bank transfer (manual deposit) — عمود مع قاعدة وسقف (نمط معماري
 * كلاسيكي للبنك) مع شريط أفقي. تُعرَض كوسيلة دفع في واجهة checkout
 * بعد إزالة الدفع عند الاستلام وSTC Pay.
 */
export function BankIcon() {
  return (
    <svg {...baseProps} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10 12 4l9 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v9M9 10v9M15 10v9M19 10v9" strokeLinecap="round" />
      <path d="M3 19h18" strokeLinecap="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </svg>
  );
}