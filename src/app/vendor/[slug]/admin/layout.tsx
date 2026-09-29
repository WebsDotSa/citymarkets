"use client";

import { useState, useEffect, use } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Clock, AlertTriangle } from "lucide-react";
import {
  buildVendorOpenStatus,
  type VendorHours,
} from '@/lib/delivery';
import { csrfFetch } from "@/lib/csrf-client";

interface VendorLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

interface VendorUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  vendor: {
    id: string;
    slug: string;
    name: string;
  };
}

export default function VendorAdminLayout({ children, params }: VendorLayoutProps) {
  const { slug } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<VendorUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Vendor's own open/close window fetched from /api/v1/vendor/settings
  // so the layout can render a sticky "المتجر مغلق" banner that mirrors
  // the same gate the checkout uses. `null` while we're still loading.
  const [vendorHours, setVendorHours] = useState<VendorHours | null>(null);

  useEffect(() => {
    // Skip the session check on /login — an unauthenticated user must
    // be able to land on the login page. Without this branch the auth
    // fetch returns 401, the layout enters the !user branch, and the
    // login page never renders (we'd show the spinner forever). The
    // login page itself runs the "already logged in?" redirect.
    if (pathname?.endsWith("/login")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [slug, pathname]);

  async function checkAuth() {
    try {
      const res = await fetch("/api/v1/vendor/auth/me", {
        credentials: "include",
      });
      const json = await res.json();

      if (!res.ok || !json.user) {
        router.replace(`/vendor/${slug}/admin/login`);
        return;
      }

      // Verify this is the correct vendor
      if (json.user.vendor.slug !== slug) {
        router.replace(`/vendor/${json.user.vendor.slug}/admin`);
        return;
      }

      setUser(json.user);
      // Fetch the vendor's settings off the auth path. We use it
      // exclusively for the hours banner — anything else (delivery
      // mode, etc.) is loaded by the settings page itself. Failure is
      // non-fatal; we just skip the banner.
      try {
        const settingsRes = await fetch("/api/v1/vendor/settings", {
          credentials: "include",
          cache: "no-store",
        });
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setVendorHours({
            id: data?.vendor?.id ?? json.user.vendor.id,
            open_time:
              typeof data?.vendor?.openTime === "string"
                ? data.vendor.openTime
                : "09:00",
            close_time:
              typeof data?.vendor?.closeTime === "string"
                ? data.vendor.closeTime
                : "23:00",
            is_active: data?.vendor?.isActive !== false,
            name: json.user.vendor.name,
            slug: json.user.vendor.slug,
          });
        }
      } catch {
        /* ignore — banner stays hidden */
      }
    } catch {
      router.replace(`/vendor/${slug}/admin/login`);
    } finally {
      setLoading(false);
    }
  }

  const handleLogout = async () => {
    try {
      await csrfFetch("/api/v1/vendor/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout error:", error);
    }
    setUser(null);
    router.push(`/vendor/${slug}/admin/login`);
  };

  // Login route is checked BEFORE the loading spinner / auth gate so
  // that:
  //   1. SSR renders the bare children directly — no flash of spinner
  //      for unauthenticated users hitting /login.
  //   2. The page itself owns the "already logged in? bounce to admin"
  //      redirect (it runs in its own useEffect on mount).
  // This branch fires even when loading=true because the layout's
  // useEffect has been wired to skip the auth fetch on /login too.
  if (pathname?.endsWith("/login")) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-gray-500">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const navItems = [
    { href: `/vendor/${slug}/admin`, label: "لوحة التحكم", icon: "📊" },
    { href: `/vendor/${slug}/admin/products`, label: "المنتجات", icon: "📦" },
    { href: `/vendor/${slug}/admin/categories`, label: "الأقسام", icon: "🗂️" },
    { href: `/vendor/${slug}/admin/orders`, label: "الأوردرات", icon: "📋" },
    { href: `/vendor/${slug}/admin/coupons`, label: "الكوبونات", icon: "🎟️" },
    { href: `/vendor/${slug}/admin/staff`, label: "الموظفون", icon: "👥" },
    { href: `/vendor/${slug}/admin/settings`, label: "الإعدادات", icon: "⚙️" },
  ];

  // Open/close status for the banner. Re-evaluated on every render so
  // the wall-clock minute boundary flips the badge without a manual
  // refetch — the page is already a client component.
  const status = buildVendorOpenStatus(vendorHours);

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 right-0 w-64 bg-white shadow-xl transform transition-transform duration-300 z-50 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 border-b">
          <h2 className="font-bold text-lg text-gray-900">{user.vendor.name}</h2>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                pathname === item.href
                  ? "bg-primary text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-red-600 hover:bg-red-50 transition-colors"
          >
            <span>🚪</span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="lg:mr-64">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                {user.fullName}
              </span>
              <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs">
                {user.role === "owner" ? "مالك" : user.role === "manager" ? "مدير" : user.role === "staff" ? "موظف" : "مشاهد"}
              </span>
            </div>

            <Link
              href={`/vendors/${slug}`}
              target="_blank"
              className="text-sm text-primary hover:underline"
            >
              عرض المتجر
            </Link>
          </div>
        </div>

        {/* Page content */}
        <main className="p-4">
          {/* Open/close banner — mirrors the customer-side checkout
              gate. Renders a sticky banner above the page contents
              whenever the vendor's own hours have the storefront
              outside the configured window OR `is_active` is forced
              off. Does NOT block pages (the manager may still need to
              flip hours back on), just advertises the closed state. */}
          {vendorHours && !status.open && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-900 shadow-sm"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{status.message}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-red-700/80">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    ساعات العمل: {status.openTime} — {status.closeTime}
                  </span>
                </p>
              </div>
              <Link
                href={`/vendor/${slug}/admin/settings`}
                className="text-xs font-semibold underline underline-offset-2 hover:text-red-700"
              >
                تعديل
              </Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
