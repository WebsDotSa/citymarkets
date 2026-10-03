"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Bell,
  BellRing,
  ShoppingBag,
  AlertTriangle,
  Package,
  Check,
  CheckCircle2,
  RefreshCw,
  Filter,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import type { AdminAlert } from "@/lib/admin-types";

const adminCred: RequestInit = { credentials: "include" };

type Severity = AdminAlert["severity"];
type NType = AdminAlert["type"];
type NotificationItem = AdminAlert;

const SEVERITY_CLASSES: Record<Severity, string> = {
  info: "bg-blue-50 border-blue-200 text-blue-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  critical: "bg-red-50 border-red-200 text-red-700",
  success: "bg-primary-50 border-primary-200 text-primary-700",
};

const TYPE_LABELS: Record<NType, string> = {
  new_order: "طلب جديد",
  low_stock: "مخزون منخفض",
  out_of_stock: "نفد المخزون",
  payment: "دفع",
  system: "نظام",
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "الآن";
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 7) return `قبل ${d} يوم`;
  return new Date(iso).toLocaleDateString("ar-SA");
}

function TypeIcon({ type }: { type: NType }) {
  const map = {
    new_order: <ShoppingBag className="w-5 h-5" />,
    low_stock: <AlertTriangle className="w-5 h-5" />,
    out_of_stock: <AlertTriangle className="w-5 h-5" />,
    payment: <CheckCircle2 className="w-5 h-5" />,
    system: <Bell className="w-5 h-5" />,
  };
  return map[type] ?? <Bell className="w-5 h-5" />;
}

export default function AdminNotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    unread: 0,
    newOrders: 0,
    lowStock: 0,
    outOfStock: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<NType | "all">("all");
  const [hideRead, setHideRead] = useState(false);
  const { showToast } = useToast();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notifications", {
        ...adminCred,
        signal,
      }).then((r) => r.json());
      if (signal?.aborted) return;
      if (res.success) {
        setItems(res.data || []);
        if (res.stats) setStats(res.stats);
      }
    } catch (e) {
      if (!signal?.aborted) {
        console.error(e);
        showToast("فشل تحميل الإشعارات", "error");
      }
    }
    if (!signal?.aborted) setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  const handleMarkRead = async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
    try {
      await csrfFetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        ...adminCred,
      });
    } catch {
      // optimistic — silent
    }
  };

  const handleMarkAll = async () => {
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    try {
      await csrfFetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
        ...adminCred,
      });
      showToast("تم تعليم الكل كمقروء", "success");
    } catch {
      showToast("فشل التحديث", "error");
    }
  };

  const filtered = items.filter((i) => {
    if (filterType !== "all" && i.type !== filterType) return false;
    if (hideRead && i.is_read) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
            <BellRing className="w-6 h-6 text-primary" />
            مركز الإشعارات
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            الطلبات الجديدة، تنبيهات المخزون، والأحداث المهمة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
          <button
            onClick={handleMarkAll}
            disabled={stats.unread === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            تعليم الكل كمقروء
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-500">إجمالي الإشعارات</p>
          <p className="text-2xl font-bold text-secondary mt-1">{stats.total}</p>
        </div>
        <Link
          href="/admin/orders"
          className="bg-white rounded-xl border border-blue-200 p-4 hover:border-blue-400 transition-colors"
        >
          <p className="text-xs text-blue-700 flex items-center gap-1">
            <ShoppingBag className="w-3 h-3" /> طلبات جديدة
          </p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{stats.newOrders}</p>
        </Link>
        <Link
          href="/admin/inventory"
          className="bg-white rounded-xl border border-amber-200 p-4 hover:border-amber-400 transition-colors"
        >
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> مخزون منخفض
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.lowStock}</p>
        </Link>
        <Link
          href="/admin/inventory"
          className="bg-white rounded-xl border border-red-200 p-4 hover:border-red-400 transition-colors"
        >
          <p className="text-xs text-red-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> نفد المخزون
          </p>
          <p className="text-2xl font-bold text-red-700 mt-1">{stats.outOfStock}</p>
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Filter className="w-4 h-4" />
            <span>تصفية:</span>
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as NType | "all")}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary"
          >
            <option value="all">كل الأنواع</option>
            <option value="new_order">طلبات جديدة</option>
            <option value="low_stock">مخزون منخفض</option>
            <option value="out_of_stock">نفد المخزون</option>
            <option value="payment">مدفوعات</option>
            <option value="system">نظام</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={hideRead}
              onChange={(e) => setHideRead(e.target.checked)}
              className="rounded accent-primary"
            />
            <span>إخفاء المقروء</span>
          </label>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700">كل شيء على ما يرام</h3>
            <p className="text-sm text-gray-500 mt-1">
              لا توجد إشعارات تطابق التصفية الحالية
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((n) => (
              <li
                key={n.id}
                className={`p-4 flex items-start gap-4 hover:bg-gray-50/50 transition-colors ${
                  !n.is_read ? "bg-primary/5" : ""
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                    SEVERITY_CLASSES[n.severity] || SEVERITY_CLASSES.info
                  }`}
                >
                  <TypeIcon type={n.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-tiny uppercase tracking-wider font-bold text-gray-500">
                      {TYPE_LABELS[n.type] || n.type}
                    </span>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                    <span className="text-xs text-gray-400">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-secondary mt-0.5">
                    {n.title}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">{n.message}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      className="p-2 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg"
                      title="تعليم كمقروء"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  {n.link && (
                    <Link
                      href={n.link}
                      className="p-2 text-primary hover:bg-primary/10 rounded-lg text-sm font-medium"
                      title="عرض"
                    >
                      عرض ←
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
