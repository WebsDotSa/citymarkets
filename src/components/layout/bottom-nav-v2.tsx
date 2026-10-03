"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthState } from "@/contexts/auth-context";
import { useWishlistState } from "@/contexts/wishlist-context";
import {
  ShoppingBasket,
  LayoutGrid,
  ShoppingBag,
  User,
  Gift,
  Heart,
  ChefHat,
} from "lucide-react";

const navItems = [
  { href: "/", label: "الرئيسية", icon: ShoppingBasket, requiresAuth: false },
  { href: "/categories", label: "التصنيفات", icon: LayoutGrid, requiresAuth: false },
  { href: "/ai-chat", label: "شيف سيتي", icon: ChefHat, requiresAuth: false, accent: true },
  { href: "/offers", label: "التخفيضات", icon: Gift, requiresAuth: false },
  { href: "/wishlist", label: "المفضلة", icon: Heart, requiresAuth: false, showBadge: true },
  { href: "/orders", label: "الطلبات", icon: ShoppingBag, requiresAuth: true },
  { href: "/profile", label: "حسابي", icon: User, requiresAuth: false },
];

export function BottomNavV2() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthState();
  const { itemCount: wishlistCount } = useWishlistState();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-gray-100 safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="max-w-7xl mx-auto flex items-stretch justify-around h-16 px-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const needsLogin = item.requiresAuth && !user;

          const onClick = (e: React.MouseEvent) => {
            if (needsLogin) {
              e.preventDefault();
              router.push(`/auth/login?redirect=${encodeURIComponent(item.href)}`);
            }
          };

          return (
            <Link
              key={item.href}
              href={needsLogin ? "/auth/login" : item.href}
              onClick={onClick}
              className="flex flex-col items-center justify-center flex-1 gap-0.5 relative pt-1 min-w-0 px-1"
            >
              <div className="relative">
                {item.accent ? (
                  <div
                    className={`w-9 h-9 md:w-11 md:h-11 -mt-1 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isActive
                        ? "bg-primary text-white shadow-md shadow-primary/30"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <Icon className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2.2} />
                  </div>
                ) : (
                  <Icon
                    className={`w-5 h-5 md:w-6 md:h-6 transition-all duration-200 ${
                      isActive ? "text-primary" : "text-gray-400"
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                )}
                {/* Wishlist badge */}
                {item.showBadge && wishlistCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 md:w-5 md:h-5 bg-red-500 text-white text-3xs md:text-tiny font-bold rounded-full flex items-center justify-center min-w-[16px] animate-bounce-in"
                  >
                    {wishlistCount > 9 ? "9+" : wishlistCount}
                  </span>
                )}
              </div>
              <span
                className={`text-tiny md:text-xs font-medium transition-colors truncate ${
                  isActive
                    ? item.accent
                      ? "text-primary font-bold"
                      : "text-primary"
                    : item.accent
                      ? "text-primary/80"
                      : "text-gray-400"
                }`}
              >
                {item.label}
              </span>
              {isActive && !item.accent && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Compact version with fewer items
const compactNavItems = [
  { href: "/", label: "الرئيسية", icon: ShoppingBasket },
  { href: "/categories", label: "التصنيفات", icon: LayoutGrid },
  { href: "/cart", label: "السلة", icon: ShoppingBag, showBadge: true },
  { href: "/profile", label: "حسابي", icon: User },
];

export function BottomNavCompact({ cartCount = 0 }: { cartCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthState();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-gray-100 safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="max-w-7xl mx-auto flex items-stretch justify-around h-16 px-1">
        {compactNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center flex-1 gap-0.5 relative pt-1"
            >
              <div className="relative">
                <Icon
                  className={`w-6 h-6 transition-all duration-200 ${
                    isActive ? "text-primary" : "text-gray-400"
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {/* Cart badge */}
                {item.showBadge && cartCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-orange-500 text-white text-tiny font-bold rounded-full flex items-center justify-center"
                    style={{ animation: "bounce-in 0.3s ease-out" }}
                  >
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </div>
              <span
                className={`text-tiny font-medium transition-colors ${
                  isActive ? "text-primary" : "text-gray-400"
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
