"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { DataTable } from "@/components/admin/data-table";
import { useToast, useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from '@/lib/catalog';
import { Sparkles, Plus, Filter, X } from "lucide-react";
import type { AdminOffer } from "@/lib/admin-types";

const adminCred: RequestInit = { credentials: "include" };

function AdminOffersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive" | "live" | "expired" | "scheduled"
  >("all");
  const [featuredFilter, setFeaturedFilter] = useState<"all" | "yes" | "no">(
    "all",
  );
  const { showToast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, []);

  // Honor ?new=1 — but offers uses /admin/offers/new so just refresh.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      // No-op; route serves from /admin/offers/new. Keep list fresh.
      loadData();
    }
  }, [searchParams]);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminOffer[]>("/api/admin/offers", { signal });
      if (signal?.aborted) return;
      if (res.success) setOffers(res.data || []);
      else if (res.error) showToast(res.error, "error");
    } catch (e) {
      if (!signal?.aborted) {
        console.error(e);
        showToast("فشل تحميل العروض", "error");
      }
    }
    if (!signal?.aborted) setLoading(false);
  };

  const handleDelete = async (item: AdminOffer) => {
    if (
      !(await confirm({
        title: "حذف عرض",
        message: `هل أنت متأكد من حذف العرض "${item.title_ar}"؟`,
        danger: true,
      }))
    )
      return;
    try {
      const res = await csrfFetch(`/api/admin/offers/${item.id}`, {
        method: "DELETE",
        ...adminCred,
      });
      const json = await res.json();
      if (json.success) {
        loadData();
        showToast("تم حذف العرض", "success");
      } else {
        showToast(json.error || "فشل الحذف", "error");
      }
    } catch {
      showToast("فشل في حذف العرض", "error");
    }
  };

  // Helpers — compute time-window status relative to "now"
  const getStatus = (o: AdminOffer): "live" | "scheduled" | "ended" => {
    const now = Date.now();
    const start = new Date(o.starts_at).getTime();
    const end = new Date(o.ends_at).getTime();
    if (now < start) return "scheduled";
    if (now > end) return "ended";
    return "live";
  };

  const scopeSummary = (o: AdminOffer) => {
    const t = o.target_summary;
    if (!t) return "—";
    if (t.all) return "كل المنتجات";
    const parts: string[] = [];
    if (t.product > 0) parts.push(`${t.product} منتج`);
    if (t.category > 0) parts.push(`${t.category} فئة`);
    if (t.vendor > 0) parts.push(`${t.vendor} متجر`);
    return parts.length > 0 ? parts.join(" • ") : "—";
  };

  // Filters
  const filtered = useMemo(() => {
    let list = offers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.title_ar.toLowerCase().includes(q) ||
          (o.title_en || "").toLowerCase().includes(q),
      );
    }
    if (statusFilter === "active") {
      list = list.filter((o) => o.is_active);
    } else if (statusFilter === "inactive") {
      list = list.filter((o) => !o.is_active);
    } else if (statusFilter === "live") {
      list = list.filter((o) => o.is_active && getStatus(o) === "live");
    } else if (statusFilter === "expired") {
      list = list.filter((o) => getStatus(o) === "ended");
    } else if (statusFilter === "scheduled") {
      list = list.filter((o) => getStatus(o) === "scheduled");
    }
    if (featuredFilter === "yes") {
      list = list.filter((o) => o.is_featured);
    } else if (featuredFilter === "no") {
      list = list.filter((o) => !o.is_featured);
    }
    return list;
  }, [offers, search, statusFilter, featuredFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = offers.length;
    let live = 0;
    let scheduled = 0;
    let ended = 0;
    let featured = 0;
    for (const o of offers) {
      if (o.is_featured) featured++;
      const s = getStatus(o);
      if (s === "live") live++;
      else if (s === "scheduled") scheduled++;
      else ended++;
    }
    return { total, live, scheduled, ended, featured };
  }, [offers]);

  const discountLabel = (o: AdminOffer) =>
    o.discount_type === "percentage"
      ? `${o.discount_value}%`
      : `${o.discount_value} ر.س`;

  const statusBadge = (o: AdminOffer) => {
    if (!o.is_active) {
      return (
        <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700">
          غير نشط
        </span>
      );
    }
    const s = getStatus(o);
    if (s === "live") {
      return (
        <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">
          نشط الآن
        </span>
      );
    }
    if (s === "scheduled") {
      return (
        <span className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700">
          مجدول
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-1 rounded-lg bg-amber-100 text-amber-700">
        منتهٍ
      </span>
    );
  };

  const columns = [
    {
      key: "title_ar",
      label: "العرض",
      render: (row: AdminOffer) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-16 h-10 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex-shrink-0">
            {row.image_url ? (
              <Image
                src={row.image_url}
                alt={row.title_ar}
                fill
                className="object-cover"
                sizes="64px"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-secondary truncate">
              {row.title_ar}
            </p>
            {row.title_en ? (
              <p className="text-2xs text-gray-500 truncate" dir="ltr">
                {row.title_en}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "discount",
      label: "الخصم",
      render: (row: AdminOffer) => (
        <span className="text-sm font-bold text-primary">{discountLabel(row)}</span>
      ),
    },
    {
      key: "scope",
      label: "النطاق",
      render: (row: AdminOffer) => (
        <span className="text-xs text-gray-600">{scopeSummary(row)}</span>
      ),
    },
    {
      key: "window",
      label: "الفترة",
      render: (row: AdminOffer) => (
        <div className="text-2xs text-gray-500 leading-tight">
          <div>من: {new Date(row.starts_at).toLocaleDateString("ar-SA")}</div>
          <div>إلى: {new Date(row.ends_at).toLocaleDateString("ar-SA")}</div>
        </div>
      ),
    },
    {
      key: "status",
      label: "الحالة",
      render: (row: AdminOffer) => statusBadge(row),
    },
    {
      key: "is_featured",
      label: "مميّز",
      render: (row: AdminOffer) =>
        row.is_featured ? (
          <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            <Sparkles className="w-3 h-3" />
            مميّز
          </span>
        ) : (
          <span className="text-2xs text-gray-400">—</span>
        ),
    },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            إدارة العروض
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            أنشئ عروضاً ترويجية بخصومات نسبية أو ثابتة، وطبّقها على منتجات أو فئات أو متاجر
          </p>
        </div>
        <Link
          href="/admin/offers/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة عرض جديد
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">إجمالي العروض</p>
          <p className="text-2xl font-bold text-secondary mt-1">{stats.total}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">نشطة الآن</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{stats.live}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">مجدولة</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{stats.scheduled}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">منتهية</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.ended}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">مميّزة</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.featured}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="ابحث بالعنوان..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pr-3 pl-9 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {search ? (
            <button
              onClick={() => setSearch("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          <span>الحالة:</span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">الكل</option>
          <option value="live">نشطة الآن</option>
          <option value="scheduled">مجدولة</option>
          <option value="expired">منتهية</option>
          <option value="active">مفعّلة</option>
          <option value="inactive">مخفية</option>
        </select>
        <select
          value={featuredFilter}
          onChange={(e) => setFeaturedFilter(e.target.value as typeof featuredFilter)}
          className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">كل المميّزة</option>
          <option value="yes">مميّزة فقط</option>
          <option value="no">غير مميّزة</option>
        </select>
      </div>

      {/* DataTable */}
      <DataTable<AdminOffer>
        columns={columns}
        data={filtered}
        title=""
        onAdd={() => undefined}
        onEdit={(item) => {
          router.push(`/admin/offers/${item.id}/edit`);
        }}
        onDelete={handleDelete}
        loading={loading}
      />

      {confirm.dialog}
    </>
  );
}

export default function AdminOffersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <AdminOffersContent />
    </Suspense>
  );
}
