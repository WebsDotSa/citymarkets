"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAdminLogout } from "@/hooks/use-admin-logout";
import {
  Truck,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  Home,
  Calendar,
  Wallet,
} from "lucide-react";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { AdminRole } from "@/lib/admin-types";

interface DriverUser {
  name: string;
  email: string;
  role: AdminRole;
}

interface DriverSidebarProps {
  user: DriverUser;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

function DriverSidebar({ user, isOpen, onClose, onLogout }: DriverSidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const navItems = [
    {
      id: 'my-deliveries',
      label: 'طلباتي للتوصيل',
      icon: Truck,
      href: '/admin/driver',
    },
    {
      // Phase 2 / P3a: past deliveries + currently in-flight claims.
      id: 'my-history',
      label: 'سجل التوصيلات',
      icon: Calendar,
      href: '/admin/driver/history',
    },
    {
      // Phase 2 / P3b: KPI cards + daily chart of revenue and deliveries.
      id: 'my-earnings',
      label: 'أرباحي',
      icon: Wallet,
      href: '/admin/driver/earnings',
    },
  ];

  const handleLogout = useAdminLogout(onLogout);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 right-0 h-full w-[280px] bg-white border-l border-slate-200 z-50 flex flex-col
          transform transition-all duration-300 ease-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
          lg:translate-x-0 shadow-xl
        `}
      >
        {/* Logo Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-100 flex-shrink-0 bg-gradient-to-l from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center shadow-lg shadow-primary/20">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">أسواق سيتي</p>
              <p className="text-tiny text-slate-500 font-medium">مندوب التوصيل</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <div className="space-y-2">
            {/* Dashboard */}
            <Link
              href="/admin"
              onClick={onClose}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive("/admin") && !isActive("/admin/driver")
                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }
              `}
            >
              <Home className="w-5 h-5" />
              <span>لوحة التحكم</span>
            </Link>

            {/* Driver specific items */}
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onClose}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                    ${active
                      ? "bg-primary text-white shadow-lg shadow-primary/20"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                  {active && (
                    <div className="mr-auto w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex-shrink-0">
          {/* User Info */}
          <div className="flex items-center gap-3 mb-3 p-2 bg-white rounded-xl shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center text-white font-bold text-sm shadow">
              {user.name?.charAt(0) || "م"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{user.name}</p>
              <p className="text-tiny text-slate-500">مندوب توصيل</p>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>

        {/* Brand Footer */}
        <div className="p-4 border-t border-slate-100 text-center bg-gradient-to-r from-transparent via-slate-50 to-transparent flex-shrink-0">
          <CityMarketsLogo height={20} />
        </div>
      </aside>
    </>
  );
}

function DriverHeader({ onMenuClick, user }: { onMenuClick: () => void; user: DriverUser }) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:pr-6">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="فتح القائمة"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Page title - shown on mobile */}
      <div className="flex items-center gap-2 lg:hidden">
        <Truck className="w-5 h-5 text-primary" />
        <span className="font-semibold text-slate-800">طلباتي للتوصيل</span>
      </div>

      {/* Spacer for desktop */}
      <div className="hidden lg:block" />

      {/* User info - shown on mobile */}
      <div className="flex items-center gap-3 lg:hidden">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center text-white font-bold text-xs">
          {user.name?.charAt(0) || "م"}
        </div>
      </div>
    </header>
  );
}

interface DriverLayoutProps {
  children: React.ReactNode;
}

export function DriverLayout({ children }: DriverLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<DriverUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/auth/me", {
          credentials: "include",
        });
        const json = await res.json();
        if (!res.ok || !json.authenticated || !json.user) {
          localStorage.removeItem("admin_user");
          if (!cancelled) router.replace("/admin/login");
          return;
        }
        const u = json.user as DriverUser;

        // SECURITY: only delivery_driver role can land on /admin/driver.
        // A super_admin or admin landing here would see every delivery
        // order (including private addresses). Push them back to /admin.
        // Server-side requireAdminApi(request, "view_delivery_orders") on
        // the API routes remains the actual gate; this is defense in depth.
        if (u.role !== "delivery_driver") {
          if (!cancelled) {
            localStorage.removeItem("admin_user");
            router.replace("/admin");
          }
          return;
        }

        if (!cancelled) {
          setUser({ name: u.name, email: u.email, role: u.role });
          localStorage.setItem("admin_user", JSON.stringify(u));
        }
      } catch {
        localStorage.removeItem("admin_user");
        if (!cancelled) router.replace("/admin/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    router.push("/admin/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-slate-500">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Sidebar */}
      <DriverSidebar
        user={user}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={handleLogout}
      />

      {/* Main content */}
      <div className="lg:mr-[280px] transition-all duration-300">
        {/* Header */}
        <DriverHeader onMenuClick={() => setSidebarOpen(true)} user={user} />

        {/* Page content */}
        <main className="p-4 lg:p-6 min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}
