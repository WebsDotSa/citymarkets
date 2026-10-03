"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCartState } from "@/contexts/cart-context";
import { BRAND } from "@/lib/brand-theme";
import { getBottomWithSafeArea, getColorStyle } from "@/lib/style-utils";

const HIDDEN_ON = ["/cart", "/checkout", "/auth"];

/** عرض ~عرض زر الميكروفون (w-14) في الوسط لتفادي التداخل */
const VOICE_BUTTON_RESERVE = "3.75rem";

export function StickyCartBar() {
  const pathname = usePathname();
  // Needs both itemCount and subtotal — subscribe to the read-only state slice.
  const { itemCount, subtotal } = useCartState();

  // StickyCartBar stays visible on /ai-chat so users see cart updates
  // as products get added by the AI assistant. Only hide it on cart /
  // checkout / auth screens where it would overlap the page chrome.
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) {
    return null;
  }
  if (itemCount === 0) return null;

  return (
    <div
      className="fixed left-4 right-4 z-40 md:hidden flex items-center gap-2"
      style={getBottomWithSafeArea("4.25rem")}
    >
      <div
        className="flex-1 min-w-0 pointer-events-none"
        style={{ minWidth: VOICE_BUTTON_RESERVE }}
        aria-hidden
      />

      <Link
        href="/cart"
        className="h-11 shrink-0 min-w-[100px] px-3 rounded-2xl text-white flex items-center justify-between gap-2 shadow-lg"
        style={getColorStyle({ backgroundColor: BRAND.cartBar })}
      >
        <div className="flex flex-col items-end leading-tight">
          <span className="text-xs font-bold">{subtotal.toFixed(0)} ر.س</span>
          <span className="text-tiny text-white/70">{itemCount} منتج</span>
        </div>
        <div className="relative">
          <ShoppingBag className="w-5 h-5" />
          <span
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-tiny font-bold flex items-center justify-center text-white"
            style={getColorStyle({ backgroundColor: BRAND.primary })}
          >
            {itemCount > 9 ? "9+" : itemCount}
          </span>
        </div>
      </Link>
    </div>
  );
}
