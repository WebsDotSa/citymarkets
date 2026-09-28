"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { getOrderStatusConfig } from "@/lib/order-status";

interface DashboardPageProps {
  params: Promise<{ slug: string }>;
}

interface Stats {
  today: {
    ordersCount: number;
    revenue: number;
    avgOrderValue: number;
  };
  products: {
    total: number;
    active: number;
    lowStock: number;
  };
  pendingOrders: number;
  chart: Array<{ date: string; orders: number; revenue: number }>;
}

interface RecentOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerPhone: string;
  total: number;
  createdAt: string;
}


export default function VendorDashboardPage({ params }: DashboardPageProps) {
  const { slug } = use(params);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, [slug]);

  async function fetchDashboardData() {
    try {
      const [statsRes, ordersRes] = await Promise.all([
        fetch("/api/v1/vendor/dashboard/stats"),
        fetch("/api/v1/vendor/dashboard/recent-orders"),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats);
      }

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setRecentOrders(data.orders || []);
      }
    } catch (error) {
      console.error("Dashboard fetch error:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-4 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
        <p className="text-gray-500">نظرة عامة على أداء متجرك</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="📦"
          label="أوردرات اليوم"
          value={stats?.today.ordersCount || 0}
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon="💰"
          label="إيرادات اليوم"
          value={`${((stats?.today.revenue || 0)).toFixed(0)} ر.س`}
          color="bg-green-50 text-green-600"
        />
        <StatCard
          icon="📊"
          label="متوسط قيمة الطلب"
          value={`${((stats?.today.avgOrderValue || 0)).toFixed(0)} ر.س`}
          color="bg-purple-50 text-purple-600"
        />
        <StatCard
          icon="⏳"
          label="أوردرات معلقة"
          value={stats?.pendingOrders || 0}
          color="bg-orange-50 text-orange-600"
          highlight={stats?.pendingOrders ? stats.pendingOrders > 0 : false}
        />
      </div>

      {/* Products stats */}
      <div className="grid grid-cols-3 gap-4">
        <Link
          href={`/vendor/${slug}/admin/products`}
          className="bg-white rounded-2xl p-4 text-center hover:shadow-md transition"
        >
          <p className="text-2xl font-bold text-gray-900">{stats?.products.total || 0}</p>
          <p className="text-sm text-gray-500">إجمالي المنتجات</p>
        </Link>
        <div className="bg-white rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats?.products.active || 0}</p>
          <p className="text-sm text-gray-500">منتجات نشطة</p>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center">
          <p className={`text-2xl font-bold ${(stats?.products.lowStock || 0) > 0 ? "text-red-600" : "text-gray-900"}`}>
            {stats?.products.lowStock || 0}
          </p>
          <p className="text-sm text-gray-500">مخزون منخفض</p>
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-bold text-gray-900">آخر الأوردرات</h2>
          <Link href={`/vendor/${slug}/admin/orders`} className="text-sm text-primary hover:underline">
            عرض الكل
          </Link>
        </div>

        {recentOrders.length > 0 ? (
          <div className="divide-y">
            {recentOrders.slice(0, 5).map((order) => {
              const status = getOrderStatusConfig(order.status);
              return (
                <Link
                  key={order.id}
                  href={`/vendor/${slug}/admin/orders`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                      📋
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{order.orderNumber}</p>
                      <p className="text-xs text-gray-500">{order.customerPhone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded-full text-xs ${status.color}`}>
                      {status.label}
                    </span>
                    <span className="font-bold text-gray-900">{order.total.toFixed(2)} ر.س</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500">لا توجد أوردرات حتى الآن</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: string;
  label: string;
  value: string | number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-4 ${color} ${highlight ? "ring-2 ring-orange-500" : ""}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-sm opacity-80">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
