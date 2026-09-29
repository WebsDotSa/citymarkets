"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { useCart, useCartItemCount } from "@/contexts/cart-context";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useWishlistState } from "@/contexts/wishlist-context";
import {
  useDeliveryLocationState,
  useDeliveryLocationActions,
} from "@/contexts/delivery-location-context";
import { shortAddressLabel } from '@/lib/delivery';
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  ShoppingCart,
  User,
  Heart,
  Menu,
  X,
  ChevronDown,
  LogOut,
  Package,
  MapPin,
  Sparkles,
  Settings,
  Bell,
  Store,
  ChevronLeft,
  Locate,
  ChefHat,
} from "lucide-react";

interface HeaderV2Props {
  variant?: "default" | "transparent" | "minimal" | "glass";
}

export function HeaderV2({ variant = "default" }: HeaderV2Props) {
  const pathname = usePathname();
  const router = useRouter();
  // Preserve the current page so the login flow can bounce the user back
  // after auth instead of dumping them on the home page.
  const loginHref =
    pathname && pathname !== "/auth/login"
      ? `/auth/login?redirect=${encodeURIComponent(pathname + (typeof window !== "undefined" ? window.location.search : ""))}`
      : "/auth/login";
  const { user } = useAuthState();
  const { signOut } = useAuthActions();
  const { selectedAddress } = useDeliveryLocationState();
  const { openSheet } = useDeliveryLocationActions();
  // Cart badge: subscribe only to itemCount so this header doesn't re-render
  // when items/subtotal change — only when the visible count flips.
  const itemCount = useCartItemCount();
  const { itemCount: wishlistCount } = useWishlistState();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close menus on click outside
  useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

  // Handle escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
        setSearchOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/catalog?search=${encodeURIComponent(searchQuery)}`);
      setSearchOpen(false);
    }
  }, [searchQuery, router]);

  const handleSignOut = async () => {
    await signOut();
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  };

  // Glass morphism header for hero pages
  const glassStyles = variant === "glass" || variant === "transparent";
  
  const headerBg = glassStyles
    ? "bg-white/80 backdrop-blur-xl border-b border-white/20"
    : "bg-white/95 backdrop-blur-xl shadow-sm border-b border-gray-100/50";

  return (
    <>
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:right-4 focus:z-[100] focus:px-6 focus:py-3 focus:bg-primary focus:text-white focus:rounded-2xl focus:font-semibold"
      >
        تخطي إلى المحتوى الرئيسي
      </a>

      {/* Main Header */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${headerBg}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 sm:h-20">
            {/* Right side - Logo & Location */}
            <div className="flex items-center gap-3">
              <CityMarketsLogo
                height={variant === "transparent" ? 40 : 36}
                href="/"
                className={variant === "transparent" ? "text-white" : ""}
              />
              {/* Location Button */}
              <button
                onClick={openSheet}
                className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 ${
                  glassStyles
                    ? "text-white/90 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label="تحديد الموقع"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-l from-[#009345] to-[#00B359] flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-white" />
                </div>
                <div className="text-right hidden lg:block">
                  <p className="text-[10px] opacity-70">التوصيل إلى</p>
                  <p className="text-sm font-semibold flex items-center gap-1">
                    {shortAddressLabel(selectedAddress)}
                    <ChevronDown className="w-3 h-3 opacity-70" />
                  </p>
                </div>
              </button>

              {/* AI Chat (Chef City) — accent pill placed at top-right
                  next to the location button so it sits right next to
                  the central search bar. Mirrors the BottomNavV2
                  accent treatment so the same affordance is reachable
                  from the header and from the bottom nav. */}
              <Link
                href="/ai-chat"
                aria-label="شيف سيتي - المساعد الذكي"
                className={`hidden md:flex items-center gap-2 h-11 px-3 rounded-2xl text-sm font-semibold transition-all duration-200 ${
                  glassStyles
                    ? "bg-white/20 text-white hover:bg-white/30 backdrop-blur"
                    : "bg-gradient-to-l from-[#009345] to-[#00B359] text-white shadow-md shadow-[#009345]/20 hover:shadow-lg hover:shadow-[#009345]/30"
                }`}
              >
                <ChefHat className="w-4 h-4" strokeWidth={2.2} />
                <span>شيف سيتي</span>
              </Link>
            </div>

            {/* Center - Search Bar (Desktop) */}
            <div className="hidden md:flex flex-1 max-w-xl mx-8">
              <form onSubmit={handleSearch} className="w-full relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن منتجات، فئات، أو العلامات..."
                  className={`w-full h-11 pr-12 pl-4 rounded-2xl text-sm transition-all duration-200 ${
                    glassStyles
                      ? "bg-white/20 text-white placeholder:text-white/70 border border-white/30 focus:bg-white/30 focus:border-white/50"
                      : "bg-gray-50 text-gray-900 placeholder:text-gray-400 border border-gray-200 focus:bg-white focus:border-primary focus:ring-2 focus:ring-[#009345]/20"
                  }`}
                />
                <Search className={`absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 ${
                  glassStyles ? "text-white/70" : "text-gray-400"
                }`} />
              </form>
            </div>

            {/* Left side - Actions */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Search Toggle (Mobile) */}
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className={`p-2.5 rounded-xl transition-all duration-200 ${
                  glassStyles
                    ? "text-white/80 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label="البحث"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Vendors Link */}
              <Link
                href="/vendors"
                className={`p-2.5 rounded-xl transition-all duration-200 hidden sm:flex items-center gap-1 ${
                  glassStyles
                    ? "text-white/80 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label="المتاجر"
              >
                <Store className="w-5 h-5" />
              </Link>

              {/* Wishlist */}
              <Link
                href="/wishlist"
                className={`relative p-2.5 rounded-xl transition-all duration-200 hidden sm:flex items-center gap-1 ${
                  glassStyles
                    ? "text-white/80 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label={`المفضلة - ${wishlistCount} منتجات`}
              >
                <Heart className="w-5 h-5" />
                {wishlistCount > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-bounce-in">
                    {wishlistCount > 9 ? "9+" : wishlistCount}
                  </span>
                )}
              </Link>

              {/* Cart */}
              <Link
                href="/cart"
                className={`relative p-2.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
                  glassStyles
                    ? "text-white/80 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label={`السلة - ${itemCount} منتجات`}
              >
                <div className="relative">
                  <ShoppingCart className="w-5 h-5" />
                  {itemCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce-in shadow-lg shadow-orange-500/30">
                      {itemCount > 9 ? "9+" : itemCount}
                    </span>
                  )}
                </div>
                <span className="hidden sm:inline text-sm font-medium">
                  {itemCount > 0 ? `${itemCount}` : ""}
                </span>
              </Link>

              {/* User Menu */}
              {user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    className={`flex items-center gap-2 p-1.5 rounded-xl transition-all duration-200 ${
                      glassStyles
                        ? "text-white/80 hover:bg-white/20"
                        : "text-gray-600 hover:bg-gray-100"
                    } ${userMenuOpen ? "bg-primary-100 text-primary-700" : ""}`}
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    aria-expanded={userMenuOpen}
                    aria-label="قائمة المستخدم"
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                      glassStyles
                        ? "bg-white/20 text-white"
                        : "bg-primary-100 text-primary-700"
                    }`}>
                      <User className="w-4 h-4" />
                    </div>
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 hidden sm:block ${
                      userMenuOpen ? "rotate-180" : ""
                    }`} />
                  </button>

                  {/* User Dropdown */}
                  {userMenuOpen && (
                    <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50 animate-scale-in origin-top-left">
                      {/* User Info */}
                      <div className="p-4 bg-gradient-to-l from-primary-50 to-white border-b border-gray-100">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-l from-[#009345] to-[#00B359] flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-[#009345]/20">
                            {user.name?.charAt(0) || user.phone?.charAt(0) || "م"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{user.name || "مستخدم"}</p>
                            <p className="text-sm text-gray-500 dir-ltr text-right">{user.phone}</p>
                          </div>
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="p-2">
                        <Link
                          href="/profile"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <User className="w-5 h-5" />
                          <span className="font-medium">حسابي</span>
                        </Link>
                        <Link
                          href="/orders"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Package className="w-5 h-5" />
                          <span className="font-medium">طلباتي</span>
                        </Link>
                        <Link
                          href="/wishlist"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Heart className="w-5 h-5" />
                          <span className="font-medium">المفضلة</span>
                          {wishlistCount > 0 && (
                            <span className="mr-auto px-2 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-full">
                              {wishlistCount}
                            </span>
                          )}
                        </Link>
                        <button
                          type="button"
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => {
                            setUserMenuOpen(false);
                            openSheet();
                          }}
                        >
                          <MapPin className="w-5 h-5" />
                          <span className="font-medium">عناويني</span>
                        </button>
                        <Link
                          href="/loyalty"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Sparkles className="w-5 h-5" />
                          <span className="font-medium">نقاط الولاء</span>
                        </Link>
                        <Link
                          href="/profile/notifications"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Bell className="w-5 h-5" />
                          <span className="font-medium">الإشعارات</span>
                        </Link>
                        <Link
                          href="/profile/security"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <Settings className="w-5 h-5" />
                          <span className="font-medium">الإعدادات</span>
                        </Link>
                      </div>

                      {/* Logout */}
                      <div className="p-2 border-t border-gray-100">
                        <button
                          onClick={handleSignOut}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-5 h-5" />
                          <span className="font-medium">تسجيل الخروج</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href={loginHref}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    glassStyles
                      ? "bg-white/20 text-white hover:bg-white/30 backdrop-blur"
                      : "bg-gradient-to-l from-[#009345] to-[#00B359] text-white hover:shadow-lg hover:shadow-[#009345]/25"
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">دخول</span>
                </Link>
              )}

              {/* App Store Download */}
              <a
                href="https://apps.apple.com/sa/app/%D8%A3%D8%B3%D9%88%D8%A7%D9%82-%D8%B3%D9%8A%D8%AA%D9%8A/id6799888123?l=ar"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="حمّل التطبيق من App Store"
                className={`hidden sm:inline-flex items-center gap-2 h-10 px-3 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  glassStyles
                    ? "bg-white/20 text-white hover:bg-white/30 backdrop-blur"
                    : "bg-black text-white hover:bg-gray-900 border border-gray-800"
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25" />
                </svg>
                <span className="hidden md:inline">حمّل التطبيق</span>
              </a>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`md:hidden p-2.5 rounded-xl transition-all duration-200 ${
                  glassStyles
                    ? "text-white/80 hover:bg-white/20"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-expanded={mobileMenuOpen}
                aria-label={mobileMenuOpen ? "إغلاق القائمة" : "فتح القائمة"}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Search Bar */}
        {searchOpen && (
          <div className="md:hidden px-4 pb-4 animate-slide-down">
            <form onSubmit={handleSearch} className="relative">
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتجات..."
                className="w-full h-12 pr-12 pl-4 rounded-2xl bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-[#009345]/20"
                autoFocus
              />
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </form>
          </div>
        )}
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="absolute top-0 right-0 w-full max-w-sm h-full bg-white shadow-2xl animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Menu Header */}
            <div className="p-6 bg-gradient-to-l from-[#009345] to-[#00B359]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {user ? (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                        {user.name?.charAt(0) || user.phone?.charAt(0) || "م"}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{user.name || "مستخدم"}</p>
                        <p className="text-sm text-white/70 dir-ltr text-right">{user.phone}</p>
                      </div>
                    </>
                  ) : (
                    <div className="text-white">
                      <p className="font-semibold">مرحباً بك!</p>
                      <p className="text-sm text-white/70">سجل دخولك للتسوق</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-white/80 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Menu Content */}
            <nav className="p-4 space-y-1">
              {/* Location Link */}
              <button
                type="button"
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openSheet();
                }}
              >
                <Locate className="w-5 h-5 text-primary" />
                <span className="font-medium">موقع التوصيل</span>
              </button>
              {user ? (
                <>
                  <Link
                    href="/profile"
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <User className="w-5 h-5 text-primary" />
                    <span className="font-medium">حسابي</span>
                  </Link>
                  <Link
                    href="/orders"
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Package className="w-5 h-5 text-primary" />
                    <span className="font-medium">طلباتي</span>
                  </Link>
                  <Link
                    href="/wishlist"
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Heart className="w-5 h-5 text-primary" />
                    <span className="font-medium">المفضلة</span>
                    {wishlistCount > 0 && (
                      <span className="mr-auto px-2 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-full">
                        {wishlistCount}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      openSheet();
                    }}
                  >
                    <MapPin className="w-5 h-5 text-primary" />
                    <span className="font-medium">عناويني</span>
                  </button>
                  <Link
                    href="/loyalty"
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-primary-50 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span className="font-medium">نقاط الولاء</span>
                  </Link>
                  <div className="border-t border-gray-100 my-2" />
                  <button
                    onClick={handleSignOut}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                    <span className="font-medium">تسجيل الخروج</span>
                  </button>
                </>
              ) : (
                <Link
                  href={loginHref}
                  className="flex items-center justify-center gap-2 w-full px-4 py-4 bg-gradient-to-l from-[#009345] to-[#00B359] text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-[#009345]/25 transition-all"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <User className="w-5 h-5" />
                  <span>تسجيل الدخول</span>
                </Link>
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
