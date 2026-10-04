"use client";

import { useState, useEffect, useMemo, createElement } from "react";
import Link from "next/link";
import {
  Package,
  ShoppingBag,
  Users,
  DollarSign,
  ShoppingCart,
  Clock,
  FolderTree,
  LayoutTemplate,
  TicketPercent,
  BarChart3,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BellRing,
  RefreshCw,
  Activity,
  ChevronLeft,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { countsAsElectronicRevenue } from '@/lib/orders';
import { ORDER_STATUSES } from '@/lib/orders';
import { StatCard } from "@/components/admin/admin-header";
import { error as logError } from "@/lib/logger";

const fetchOpts: RequestInit = { credentials: "include" };

interface DashboardStats {
  products: number;
  orders: number;
  users: number;
  revenue: number;
  categories: number;
  coupons: number;
  lowStockProducts: number;
  pendingOrders: number;
  todayOrders: number;
  revenueGrowth: number;
  ordersGrowth: number;
  unreadNotifications: number;
}

interface RecentOrder {
  id: number;
  name: string;
  phone: string;
  total: number;
  status: string;
  payment_status: string;
  payment_method: string;
  created_at: string;
  address?: string;
}

interface ChartData {
  label: string;
  value: number;
  color: string;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    products: 0,
    orders: 0,
    users: 0,
    revenue: 0,
    categories: 0,
    coupons: 0,
    lowStockProducts: 0,
    pendingOrders: 0,
    todayOrders: 0,
    revenueGrowth: 0,
    ordersGrowth: 0,
    unreadNotifications: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [revenueByDay, setRevenueByDay] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [
        productsRes,
        ordersRes,
        analyticsRes,
        categoriesRes,
        couponsRes,
        usersRes,
        notificationsRes,
      ] = await Promise.allSettled([
        fetch("/api/admin/products?limit=100", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/orders?limit=100", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/analytics", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/categories", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/coupons", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/users", fetchOpts).then((r) => r.json()),
        fetch("/api/admin/notifications", fetchOpts).then((r) => r.json()),
      ]);

      const products =
        productsRes.status === "fulfilled" && productsRes.value.success
          ? productsRes.value.data || []
          : [];
      const orders =
        ordersRes.status === "fulfilled" && ordersRes.value.success
          ? ordersRes.value.data || []
          : [];
      const analytics =
        analyticsRes.status === "fulfilled" && analyticsRes.value.success
          ? analyticsRes.value
          : null;
      const categories =
        categoriesRes.status === "fulfilled" && categoriesRes.value.success
          ? categoriesRes.value.data || []
          : [];
      const coupons =
        couponsRes.status === "fulfilled" && couponsRes.value.success
          ? couponsRes.value.data || []
          : [];
      const usersList =
        usersRes.status === "fulfilled" && usersRes.value.success
          ? usersRes.value.data || []
          : [];
      const notifications =
        notificationsRes.status === "fulfilled" && notificationsRes.value.success
          ? notificationsRes.value.stats || { unread: 0 }
          : { unread: 0 };

      const totalRevenue = analytics
        ? Number(analytics.summary?.electronicConfirmedRevenue) || 0
        : orders
            .filter((o: Record<string, unknown>) =>
              countsAsElectronicRevenue({
                status: o.status as string,
                payment_status: o.payment_status as string,
                payment_method: o.payment_method as string,
              })
            )
            .reduce(
              (sum: number, o: Record<string, unknown>) =>
                sum + Number(o.total || 0),
              0
            );

      const lowStock = products.filter(
        (p: any) =>
          p.stock_qty != null &&
          Number(p.stock_qty) > 0 &&
          Number(p.stock_qty) <= 5
      ).length;
      const pendingOrders = orders.filter(
        (o: any) => o.status === "pending" || o.status === "confirmed"
      ).length;
      const today = new Date().toDateString();
      const todayOrders = orders.filter(
        (o: any) => new Date(o.created_at).toDateString() === today
      ).length;

      // Compute month-over-month revenue growth from real data
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
      const isElectronic = (o: Record<string, unknown>) =>
        countsAsElectronicRevenue({
          status: o.status as string,
          payment_status: o.payment_status as string,
          payment_method: o.payment_method as string,
        });
      const thisMonthRevenue = orders
        .filter(
          (o: any) =>
            isElectronic(o) && new Date(o.created_at) >= monthStart
        )
        .reduce((s: number, o: any) => s + Number(o.total || 0), 0);
      const prevMonthRevenue = orders
        .filter(
          (o: any) =>
            isElectronic(o) &&
            new Date(o.created_at) >= prevMonthStart &&
            new Date(o.created_at) < prevMonthEnd
        )
        .reduce((s: number, o: any) => s + Number(o.total || 0), 0);
      const revenueGrowth =
        prevMonthRevenue > 0
          ? Math.round(
              ((thisMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 1000
            ) / 10
          : 0;

      const thisMonthOrders = orders.filter(
        (o: any) => new Date(o.created_at) >= monthStart
      ).length;
      const prevMonthOrders = orders.filter(
        (o: any) =>
          new Date(o.created_at) >= prevMonthStart &&
          new Date(o.created_at) < prevMonthEnd
      ).length;
      const ordersGrowth =
        prevMonthOrders > 0
          ? Math.round(
              ((thisMonthOrders - prevMonthOrders) / prevMonthOrders) * 1000
            ) / 10
          : 0;

      setStats({
        products: products.length,
        orders: orders.length,
        users: usersList.length,
        revenue: totalRevenue,
        categories: categories.length,
        coupons: coupons.length,
        lowStockProducts: lowStock,
        pendingOrders,
        todayOrders,
        revenueGrowth,
        ordersGrowth,
        unreadNotifications: Number(notifications.unread) || 0,
      });

      setRecentOrders(
        orders.slice(0, 8).map((o: any) => ({
          id: o.id,
          name: o.name || o.user_name || o.guest_name || "زائر",
          phone: o.user_phone || o.guest_phone || "",
          total: Number(o.total),
          status: o.status,
          payment_status: o.payment_status,
          payment_method: o.payment_method,
          created_at: o.created_at,
          address: o.address_text,
        }))
      );

      // Real revenue chart from analytics (last 14 days for the dashboard widget)
      const analyticsRows: Array<{ day: string; revenue: number }> =
        analytics?.revenueByDay || [];
      setRevenueByDay(
        analyticsRows.slice(-14).map((r) => ({
          label: new Date(r.day).toLocaleDateString("ar-SA", {
            month: "short",
            day: "numeric",
          }),
          value: Number(r.revenue) || 0,
        }))
      );
    } catch (err) {
      // Audit I39: canonical logger.
      logError("Dashboard load error", err);
    } finally {
      setLoading(false);
    }
  };

  // Reuse the canonical status config so admin and storefront display
  // identical labels/colors. Icons are wrapped here to keep the existing
  // small-icon size used by the dashboard's recent-orders table.
  //
  // NOTE: avoid JSX member-expression like `<cfg.icon />` here — when the
  // build emits a *single* React.createElement call per item, the compiler
  // can't always resolve `cfg.icon` correctly and React #130 ("Element type
  // is invalid") gets thrown synchronously while building the object map
  // (before render even starts), surfacing as a blank dashboard. We build
  // the icon element imperatively with a defensive fallback instead.
  const statusConfig: Record<
    string,
    { label: string; className: string; icon: React.ReactNode }
  > = Object.fromEntries(
    Object.entries(ORDER_STATUSES).map(([key, cfg]) => [
      key,
      {
        label: cfg.label,
        className: cfg.color,
        icon: cfg.icon
          ? createElement(cfg.icon, { className: "w-3 h-3" })
          : null,
      },
    ]),
  );

  const quickActions = [
    {
      label: "إضافة منتج",
      href: "/admin/products?new=1",
      icon: <Package className="w-5 h-5" />,
      color: "from-primary to-primaryDark",
    },
    {
      label: "إضافة فئة",
      href: "/admin/categories/new",
      icon: <FolderTree className="w-5 h-5" />,
      color: "from-blue-500 to-blue-600",
    },
    {
      label: "إضافة كوبون",
      href: "/admin/coupons?new=1",
      icon: <TicketPercent className="w-5 h-5" />,
      color: "from-amber-500 to-amber-600",
    },
    {
      label: "إدارة الطلبات",
      href: "/admin/orders",
      icon: <ShoppingBag className="w-5 h-5" />,
      color: "from-primary-500 to-primary-600",
    },
    {
      label: "الإحصائيات",
      href: "/admin/analytics",
      icon: <BarChart3 className="w-5 h-5" />,
      color: "from-purple-500 to-purple-600",
    },
  ];

  // Real revenue chart — last 14 days from analytics endpoint
  const revenueChartData = useMemo(
    () =>
      revenueByDay.length > 0
        ? revenueByDay.map((d) => ({ ...d, color: "#009345" }))
        : [{ label: "—", value: 0, color: "#009345" }],
    [revenueByDay]
  );

  const maxRevenue = Math.max(...revenueChartData.map((d) => d.value), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="admin-spinner" />
          <p className="text-sm text-gray-500">جاري تحميل البيانات...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">لوحة التحكم</h1>
          <p className="text-sm text-gray-500 mt-1">
            نظرة عامة على متجر أسواق سيتي
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/notifications"
            className="admin-btn-icon admin-btn-ghost relative"
            title="الإشعارات"
            aria-label={`الإشعارات${stats.unreadNotifications > 0 ? ` (${stats.unreadNotifications} غير مقروءة)` : ""}`}
          >
            <BellRing className="w-5 h-5" />
            {stats.unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-tiny font-bold flex items-center justify-center">
                {stats.unreadNotifications > 99 ? "99+" : stats.unreadNotifications}
              </span>
            )}
          </Link>
          <button
            onClick={loadDashboardData}
            className="admin-btn-icon admin-btn-ghost"
            title="تحديث"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي الإيرادات"
          value={formatPrice(stats.revenue)}
          icon={<DollarSign className="w-7 h-7 text-white" />}
          trend={{ value: stats.revenueGrowth, label: "من الشهر الماضي", positive: stats.revenueGrowth > 0 }}
          variant="success"
        />
        <StatCard
          title="طلبات اليوم"
          value={stats.todayOrders}
          icon={<ShoppingCart className="w-7 h-7 text-white" />}
          trend={{ value: stats.ordersGrowth, label: "من الأمس", positive: stats.ordersGrowth > 0 }}
          variant="primary"
        />
        <StatCard
          title="طلبات معلقة"
          value={stats.pendingOrders}
          icon={<Clock className="w-7 h-7 text-white" />}
          variant="warning"
        />
        <StatCard
          title="إجمالي المنتجات"
          value={stats.products}
          icon={<Package className="w-7 h-7 text-white" />}
          variant="info"
        />
      </div>

      {/* Quick Actions */}
      <div className="admin-card p-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          إجراءات سريعة
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="group bg-gray-50 hover:bg-gray-100 rounded-xl p-4 text-center transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <div
                className={`w-12 h-12 mx-auto rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center text-white shadow-lg mb-3 group-hover:shadow-xl transition-shadow`}
              >
                {action.icon}
              </div>
              <p className="text-sm font-medium text-gray-700 group-hover:text-primary transition-colors">
                {action.label}
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="lg:col-span-2 admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">
              <ShoppingBag className="w-5 h-5 text-primary" />
              آخر الطلبات
            </h2>
            <Link
              href="/admin/orders"
              className="text-sm text-primary hover:underline flex items-center gap-1 font-medium"
            >
              عرض الكل
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            {recentOrders.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>رقم الطلب</th>
                    <th>العميل</th>
                    <th>الإجمالي</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => {
                    const status = statusConfig[order.status] || {
                      label: order.status,
                      className: "bg-gray-100 text-gray-600",
                      icon: null,
                    };
                    return (
                      <tr key={order.id}>
                        <td>
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-mono font-medium text-primary hover:underline"
                          >
                            #{String(order.id).slice(0, 8).toUpperCase()}
                          </Link>
                        </td>
                        <td>
                          <div>
                            <p className="font-medium text-gray-800">
                              {order.name}
                            </p>
                            <p className="text-xs text-gray-500" dir="ltr">
                              {order.phone}
                            </p>
                          </div>
                        </td>
                        <td className="font-bold text-primary">
                          {formatPrice(order.total)}
                        </td>
                        <td>
                          <span
                            className={`admin-badge flex items-center gap-1 w-fit ${status.className}`}
                          >
                            {status.icon}
                            {status.label}
                          </span>
                        </td>
                        <td className="text-gray-500 text-xs">
                          {new Date(order.created_at).toLocaleDateString("ar-SA")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="admin-empty">
                <ShoppingBag className="w-12 h-12 text-gray-300 mb-3" />
                <p className="admin-empty-title">لا توجد طلبات</p>
                <p className="admin-empty-description">
                  ستظهر الطلبات هنا عند وصولها
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Revenue Chart */}
          <div className="admin-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">إيرادات آخر 14 يوم</h3>
              <Link
                href="/admin/analytics"
                className="text-xs text-primary hover:underline"
              >
                التفاصيل
              </Link>
            </div>
            <div className="space-y-3">
              {revenueChartData.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-16">{item.label}</span>
                  <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primaryDark rounded-lg transition-all duration-500 flex items-center justify-end px-2"
                      style={{
                        width: `${(item.value / maxRevenue) * 100}%`,
                      }}
                    >
                      <span className="text-xs text-white font-medium">
                        {formatPrice(item.value)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          {stats.lowStockProducts > 0 && (
            <div className="admin-card p-5 border-2 border-amber-200/50 bg-gradient-to-br from-amber-50 to-orange-50">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-amber-800">
                    تنبيه المخزون
                  </h3>
                  <p className="text-xs text-amber-600 mt-1">
                    {stats.lowStockProducts} منتجات منخفضة المخزون تحتاج تعبئة
                  </p>
                  <Link
                    href="/admin/inventory"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-700 hover:text-amber-800"
                  >
                    عرض المنتجات
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Content Stats */}
          <div className="admin-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">
              إدارة المحتوى
            </h3>
            <div className="space-y-3">
              <Link
                href="/admin/categories"
                className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <FolderTree className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    الفئات
                  </span>
                </div>
                <span className="text-lg font-bold text-gray-800 group-hover:text-primary transition-colors">
                  {stats.categories}
                </span>
              </Link>
              <Link
                href="/admin/home-design"
                className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <LayoutTemplate className="w-5 h-5 text-primary-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    تصميم الصفحة الرئيسية
                  </span>
                </div>
                <ChevronLeft className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors" />
              </Link>
              <Link
                href="/admin/coupons"
                className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <TicketPercent className="w-5 h-5 text-amber-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    كوبونات الخصم
                  </span>
                </div>
                <span className="text-lg font-bold text-gray-800 group-hover:text-primary transition-colors">
                  {stats.coupons}
                </span>
              </Link>
            </div>
          </div>

          {/* Users */}
          <div className="admin-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">
                المستخدمين
              </h3>
              <Link
                href="/admin/users"
                className="text-xs text-primary hover:underline"
              >
                إدارة
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center text-white font-bold text-xl shadow-lg">
                <Users className="w-8 h-8" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-800">
                  {stats.users}
                </p>
                <p className="text-xs text-gray-500">مستخدم مسجل</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
