"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAdminLogout } from "@/hooks/use-admin-logout";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingBag,
  BarChart3,
  CreditCard,
  MapPin,
  Map,
  AlertTriangle,
  Star,
  History,
  Bell,
  Wallet,
  Image,
  TicketPercent,
  Users,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  UserCog,
  Settings,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Search,
  Activity as ActivityIcon,
  Home,
  Boxes,
  BellRing,
  Building2,
  Truck,
  Sparkles,
  Briefcase,
  Award,
  Power,
  UserPlus,
  TrendingUp,
  Sliders,
  ShoppingCart,
  FileSignature,
  LayoutTemplate,
} from "lucide-react";
import { NAV_ITEMS, ROLE_PERMISSIONS, AdminRole } from "@/lib/admin-types";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import type { LucideIcon } from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingBag,
  BarChart3,
  CreditCard,
  MapPin,
  Map,
  AlertTriangle,
  Star,
  History,
  Bell,
  Wallet,
  Image,
  TicketPercent,
  Users,
  ShieldCheck,
  UserCog,
  Settings,
  Activity: ActivityIcon,
  Boxes,
  BellRing,
  Building2,
  Truck,
  Sparkles,
  Briefcase,
  Award,
  Power,
  UserPlus,
  TrendingUp,
  Sliders,
  ShoppingCart,
  FileSignature,
  LayoutTemplate,
};

interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles: AdminRole[];
  permission: string;
  /** See NavItem in @/lib/admin-types.ts — sub-items render as visually
   *  subordinate (smaller, indented, muted). */
  sub?: boolean;
}

// Sidebar display only needs the user identity — the full `AdminUser`
// from `@/lib/admin-types` carries extra fields (id, created_at, phone,
// avatar) that aren't rendered here. Use a minimal shape so the layout's
// pre-existing display subset keeps working without re-shaping.
interface AdminUser {
  name: string;
  email: string;
  role: AdminRole;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

interface AdminSidebarProps {
  user: AdminUser;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export function AdminSidebar({ user, isOpen, onClose, onLogout }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navSearch, setNavSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["main", "content", "orders", "team"]),
  );

  // Group navigation items by category. Order matters — the sidebar
  // renders groups top-to-bottom, with the most-used entries (catalog,
  // orders) above the more occasional admin settings. Admins link is
  // surfaced under its own "إدارة الفريق" group instead of being
  // buried inside the 14-item "الإعدادات" bucket that used to be here.
  const groupedNavItems = useMemo(() => {
    const role = user.role as AdminRole;
    const perms = ROLE_PERMISSIONS[role] ?? [];

    const filterItems = (items: NavItem[]) =>
      items.filter((item) => {
        if (!item.roles.includes(role)) return false;
        if (!perms.includes(item.permission)) return false;
        return true;
      });

    const pick = (ids: string[]) =>
      filterItems(NAV_ITEMS.filter((item) => ids.includes(item.id)));

    return {
      main: pick(["dashboard"]),
      content: pick([
        "products",
        "categories",
        "inventory",
        "home-design",
        "offers",
        "coupons",
      ]),
      orders: pick(["orders", "abandoned-carts", "reviews", "payments", "notifications"]),
      marketing: pick([
        "analytics",
        "vendors-analytics",
        "vendors",
        "vendor-applications",
        "loyalty",
      ]),
      delivery: pick([
        "delivery-settings",
        "stores",
      ]),
      team: pick(["admins", "users", "employment"]),
      system: pick([
        "store-status",
        "notifications-settings",
        "payment-settings",
        "activity",
        "admin-profile",
      ]),
      driver: pick(["my-deliveries"]),
    };
  }, [user.role]);

  // Filter nav items by search
  const searchResults = useMemo(() => {
    if (!navSearch.trim()) return null;
    const search = navSearch.trim().toLowerCase();
    const role = user.role as AdminRole;
    const perms = ROLE_PERMISSIONS[role] ?? [];

    return NAV_ITEMS.filter((item) => {
      if (!item.roles.includes(role)) return false;
      if (!perms.includes(item.permission)) return false;
      return item.label.toLowerCase().includes(search);
    });
  }, [navSearch, user.role]);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const isActive = useCallback(
    (href: string) => {
      return pathname === href || pathname?.startsWith(href + "/");
    },
    [pathname]
  );

  const handleLogout = useAdminLogout(() => router.push("/admin/login"));

  const groups: NavGroup[] = [
    {
      id: "main",
      label: "الرئيسية",
      icon: Home,
      items: groupedNavItems.main,
    },
    {
      id: "content",
      label: "المحتوى",
      icon: Package,
      items: groupedNavItems.content,
    },
    {
      id: "orders",
      label: "الطلبات",
      icon: ShoppingBag,
      items: groupedNavItems.orders,
    },
    {
      id: "marketing",
      label: "التسويق والإحصائيات",
      icon: TrendingUp,
      items: groupedNavItems.marketing,
    },
    {
      id: "delivery",
      label: "التوصيل",
      icon: Truck,
      items: groupedNavItems.delivery,
    },
    {
      id: "team",
      label: "إدارة الفريق",
      icon: Users,
      items: groupedNavItems.team,
    },
    {
      id: "system",
      label: "إعدادات النظام",
      icon: Sliders,
      items: groupedNavItems.system,
    },
    {
      id: "driver",
      label: "للسائقين",
      icon: Truck,
      items: groupedNavItems.driver,
    },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden admin-animate-fade-in"
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
        {/* Logo Header (replaces gradient header per 2026 request) */}
        <div className="h-16 flex items-center justify-center px-5 border-b border-slate-100 flex-shrink-0">
          <CityMarketsLogo height={28} />
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors absolute left-3"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="ابحث في القائمة..."
              className="w-full h-10 pr-10 pl-3 bg-slate-50 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto admin-scroll">
          {searchResults !== null ? (
            // Search results mode
            <div className="space-y-1">
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-400">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>لا توجد نتائج لـ &quot;{navSearch}&quot;</p>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
                    نتائج البحث ({searchResults.length})
                  </p>
                  {searchResults.map((item) => {
                    // Defensive fallback — if `item.icon` isn't in the map
                    // (e.g. a new entry added to NAV_ITEMS without updating
                    // `iconMap`), fall back to a neutral icon instead of
                    // throwing React #130 and breaking the whole admin UI.
                    const Icon = iconMap[item.icon] ?? Boxes;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={onClose}
                        className={`
                          flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                          ${active
                            ? "bg-primary text-white shadow-lg shadow-primary/20"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }
                        `}
                      >
                        <Icon className={`w-5 h-5 ${active ? "text-white" : "text-slate-400"}`} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </>
              )}
            </div>
          ) : (
            // Grouped navigation mode
            <div className="space-y-2">
              {groups.map((group) => {
                if (group.items.length === 0) return null;
                const isExpanded = expandedGroups.has(group.id);
                const Icon = group.icon;

                return (
                  <div key={group.id}>
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        {group.label}
                      </span>
                      <ChevronRight
                        className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </button>

                    {/* Group Items */}
                    <div
                      className={`
                        overflow-hidden transition-all duration-300 ease-out
                        ${isExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"}
                      `}
                    >
                      <div className="space-y-0.5 pr-1">
                        {group.items.map((item) => {
                          // Defensive: see note above for `searchResults`.
                          const Icon = iconMap[item.icon] ?? Boxes;
                          const active = isActive(item.href);
                          const isSub = item.sub === true;

                          return (
                            <Link
                              key={item.id}
                              href={item.href}
                              onClick={onClose}
                              className={`
                                flex items-center gap-3 rounded-xl transition-all duration-200
                                ${isSub ? "py-2 ps-8 pe-3 text-[13px]" : "px-3 py-2.5 text-sm"}
                                font-medium
                                ${active
                                  ? "bg-gradient-to-l from-primary to-primaryDark text-white shadow-lg shadow-primary/20"
                                  : isSub
                                  ? "text-slate-500 hover:bg-slate-50 hover:text-slate-800 border-r-2 border-slate-200 me-2"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                }
                              `}
                            >
                              <Icon
                                className={`${isSub ? "w-4 h-4" : "w-5 h-5"} ${active ? "text-white" : isSub ? "text-slate-400" : "text-slate-400"}`}
                                size={isSub ? 16 : 20}
                              />
                              <span className="flex-1">{item.label}</span>
                              {active && (
                                <div className="w-1.5 h-1.5 rounded-full bg-white" />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex-shrink-0">
          {/* User Info */}
          <div className="flex items-center gap-3 mb-3 p-2 bg-white rounded-xl shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center text-white font-bold text-sm shadow">
              {user.name?.charAt(0) || "أ"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-500">
                {user.role === "super_admin"
                  ? "موظف عام"
                  : user.role === "admin"
                  ? "موظف"
                  : user.role === "editor"
                  ? "محرر"
                  : "مشاهد"}
              </p>
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

        {/* Brand Footer (logo moved to header) */}
        <div className="p-4 border-t border-slate-100 text-center flex-shrink-0 text-xs text-slate-400">
          لوحة التحكم
        </div>
      </aside>
    </>
  );
}
