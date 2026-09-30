"use client";

import { useMemo, useState, useRef, createElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  ExternalLink,
  Bell,
  ChevronLeft,
  Home,
  Search,
  Plus,
  Settings,
  LogOut,
  User,
  Moon,
  Sun,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { useClickOutside } from "@/hooks/use-click-outside";

interface Breadcrumb {
  label: string;
  href: string;
}

interface AdminHeaderProps {
  onMenuClick: () => void;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  showSearch?: boolean;
  onGlobalSearch?: (query: string) => void;
}

export function AdminHeader({
  onMenuClick,
  breadcrumbs = [],
  actions,
  showSearch = false,
  onGlobalSearch,
}: AdminHeaderProps) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const quickAddRef = useRef<HTMLDivElement>(null);

  useClickOutside(
    notificationRef,
    () => setShowNotifications(false),
    showNotifications
  );
  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);
  useClickOutside(quickAddRef, () => setShowQuickAdd(false), showQuickAdd);

  const currentPageLabel = useMemo(() => {
    if (breadcrumbs.length > 0) {
      return breadcrumbs[breadcrumbs.length - 1].label;
    }
    return "لوحة التحكم";
  }, [breadcrumbs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onGlobalSearch?.(searchQuery);
  };

  // Mock notifications
  const notifications = [
    {
      id: 1,
      title: "طلب جديد",
      message: "تم استلام طلب جديد رقم #1234",
      time: "منذ 5 دقائق",
      unread: true,
    },
    {
      id: 2,
      title: "مخزون منخفض",
      message: "3 منتجات أصبحت منخفضة المخزون",
      time: "منذ ساعة",
      unread: true,
    },
    {
      id: 3,
      title: "تقييم جديد",
      message: "تم إضافة تقييم 5 نجوم للمنتج",
      time: "منذ ساعتين",
      unread: false,
    },
  ];

  const quickAddItems = [
    { label: "إضافة منتج", href: "/admin/products?new=1", icon: Plus },
    { label: "إضافة فئة", href: "/admin/categories/new", icon: Plus },
    { label: "إضافة كوبون", href: "/admin/coupons?new=1", icon: Plus },
    { label: "تصميم الرئيسية", href: "/admin/home-design", icon: Plus },
    { label: "إضافة عرض", href: "/admin/offers/new", icon: Plus },
  ];

  return (
    <header className="sticky top-0 z-40 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200/80 flex items-center px-4 lg:px-6 gap-4">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="فتح القائمة"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumbs */}
      <nav
        className="flex items-center gap-1.5 text-sm min-w-0 flex-1"
        aria-label="مسار التنقل"
      >
        <Link
          href="/admin"
          className="flex items-center gap-1 text-slate-500 hover:text-primary transition-colors flex-shrink-0"
        >
          <Home className="w-4 h-4" />
          <span className="hidden sm:inline">الرئيسية</span>
        </Link>
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span
              key={crumb.href}
              className="flex items-center gap-1.5 min-w-0"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
              {isLast ? (
                <span className="font-semibold text-slate-800 truncate">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="text-slate-500 hover:text-primary transition-colors truncate"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Global Search (optional) */}
        {showSearch && (
          <form onSubmit={handleSearch} className="hidden md:block">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث سريع..."
                className="w-48 h-9 pr-9 pl-3 bg-slate-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
              />
            </div>
          </form>
        )}

        {/* Quick Add */}
        <div className="relative" ref={quickAddRef}>
          <button
            onClick={() => setShowQuickAdd(!showQuickAdd)}
            className="p-2 text-slate-500 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
            title="إضافة سريع"
          >
            <Plus className="w-5 h-5" />
          </button>
          {showQuickAdd && (
            <div className="admin-dropdown admin-animate-scale-in">
              <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                إضافة سريع
              </div>
              {quickAddItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="admin-dropdown-item"
                  onClick={() => setShowQuickAdd(false)}
                >
                  {item.icon
                    ? createElement(item.icon, { className: "w-4 h-4" })
                    : null}
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="الإشعارات"
          >
            <Bell className="w-5 h-5" />
            {notifications.some((n) => n.unread) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
            )}
          </button>
          {showNotifications && (
            <div className="admin-dropdown admin-animate-scale-in w-80">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-800">الإشعارات</span>
                <button className="text-xs text-primary hover:underline">قراءة الكل</button>
              </div>
              <div className="max-h-80 overflow-y-auto admin-scroll">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0 ${
                      notif.unread ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {notif.unread && (
                        <span className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {notif.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {notif.message}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {notif.time}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-slate-100">
                <Link
                  href="/admin/notifications"
                  className="text-xs text-primary hover:underline font-medium"
                >
                  عرض كل الإشعارات
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* View Site */}
        <Link
          href="/"
          target="_blank"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 rounded-lg font-medium transition-colors"
        >
          <span>الموقع</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center text-white font-bold text-sm shadow">
              م
            </div>
            <ChevronLeft className="w-4 h-4 text-slate-400 hidden sm:block" />
          </button>
          {showUserMenu && (
            <div className="admin-dropdown admin-animate-scale-in">
              <Link
                href="/admin/settings/profile"
                className="admin-dropdown-item"
                onClick={() => setShowUserMenu(false)}
              >
                <User className="w-4 h-4" />
                حسابي
              </Link>
              <Link
                href="/admin/settings"
                className="admin-dropdown-item"
                onClick={() => setShowUserMenu(false)}
              >
                <Settings className="w-4 h-4" />
                الإعدادات
              </Link>
              <div className="admin-dropdown-divider" />
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  // Handle logout
                }}
                className="w-full admin-dropdown-item text-red-600 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>

        {/* Custom actions */}
        {actions}
      </div>
    </header>
  );
}

// Page header for consistent page titles
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: {
    label: string;
    variant: "default" | "success" | "warning" | "danger" | "info";
  };
  tabs?: {
    label: string;
    value: string;
    count?: number;
  }[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  tabs,
  activeTab,
  onTabChange,
}: PageHeaderProps) {
  const badgeStyles = {
    default: "bg-slate-100 text-slate-600",
    success: "bg-primary-100 text-primary-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
            {badge && (
              <span
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg ${badgeStyles[badge.variant]}`}
              >
                {badge.label}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm text-slate-500 mt-1">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div className="admin-tabs mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onTabChange?.(tab.value)}
              className={`admin-tab flex items-center gap-2 ${
                activeTab === tab.value ? "admin-tab-active" : ""
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.value
                      ? "bg-white/20 text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Stats card for dashboard
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  variant = "default",
  className = "",
}: StatCardProps) {
  const variantClasses = {
    default: "from-slate-500 to-slate-600",
    primary: "from-primary to-primaryDark",
    success: "from-primary-500 to-primary-600",
    warning: "from-amber-500 to-amber-600",
    danger: "from-red-500 to-red-600",
    info: "from-blue-500 to-blue-600",
  };

  return (
    <div
      className={`admin-card p-5 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-3xl font-bold text-slate-800 mt-2">{value}</p>
          {trend && (
            <div
              className={`flex items-center gap-1 mt-2 text-sm font-medium ${
                trend.positive !== undefined
                  ? trend.positive
                    ? "text-primary-600"
                    : "text-red-600"
                  : "text-slate-500"
              }`}
            >
              {trend.positive !== undefined ? (
                trend.positive ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )
              ) : null}
              <span>
                {trend.value > 0 ? "+" : ""}
                {trend.value}% {trend.label}
              </span>
            </div>
          )}
        </div>
        <div
          className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${variantClasses[variant]} flex items-center justify-center shadow-lg`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

// Missing imports for StatCard
function TrendingUp({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function TrendingDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}
