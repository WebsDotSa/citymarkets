"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Search,
  Power,
  EyeOff,
  CheckSquare,
  X,
} from "lucide-react";
import { useToast, useConfirm } from "@/components/ui/toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Pagination } from "@/components/ui/pagination";
import { csrfFetch } from "@/lib/csrf-client";
import type { Product, Category } from "@/lib/types";

const adminCred: RequestInit = { credentials: "include" };
const LOW_STOCK_THRESHOLD = 5;

function ProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [stats, setStats] = useState({ lowStock: 0, outOfStock: 0, inactive: 0, active: 0 });
  const [bulkActivating, setBulkActivating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  // True once the URL→state effect has applied the forwarded query params
  // from the edit page. While false, we skip the data fetch so the very
  // first request carries the restored filters (page / category / etc.)
  // instead of firing once with defaults and then a second time with the
  // real filters. Prevents a wasteful duplicate request and a flash of
  // wrong rows when returning from edit/new.
  const [hasRestored, setHasRestored] = useState(false);
  const lastSearch = useRef("");
  const { showToast } = useToast();
  const confirm = useConfirm();

  // Auto-switch to new-product form when ?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      router.push("/admin/products/new");
    }
  }, [searchParams, router]);

  // Restore list state from URL on mount so that returning from the edit
  // page (which forwards page / filters via query string) lands the user
  // on the same page they left — and the same category / search filters.
  useEffect(() => {
    const sp = searchParams;
    const urlPage = sp.get("page");
    const urlCategory = sp.get("category_id");
    const urlStatus = sp.get("is_active");
    const urlSearch = sp.get("search");
    const urlLimit = sp.get("limit");

    if (urlPage) {
      const n = parseInt(urlPage, 10);
      if (Number.isFinite(n) && n >= 1) setPage(n);
    }
    if (urlCategory) setFilterCategory(urlCategory);
    if (urlStatus === "true") setFilterStatus("active");
    else if (urlStatus === "false") setFilterStatus("inactive");
    if (urlSearch) {
      setSearch(urlSearch);
      lastSearch.current = urlSearch;
    }
    if (urlLimit) {
      const n = parseInt(urlLimit, 10);
      if ([10, 20, 50, 100].includes(n)) setPageSize(n);
    }
    // Signal that the URL has been read so the data fetch effect can
    // proceed with the restored filters. Run once on mount — subsequent
    // filter changes update local state without rewriting the URL.
    setHasRestored(true);

    // Pick up a post-save toast that the edit/new page stashed in
    // sessionStorage before its hard reload. Show it once, then clear
    // the slot so a normal page refresh doesn't replay the toast.
    try {
      const raw = sessionStorage.getItem("admin:products:post-save-toast");
      if (raw) {
        const parsed = JSON.parse(raw) as {
          kind?: "success" | "error" | "info";
          message?: string;
          at?: number;
        };
        // Only honour toasts less than 30 s old so a stale tab opened
        // from history doesn't pop a toast meant for an earlier session.
        if (
          parsed?.message &&
          typeof parsed.at === "number" &&
          Date.now() - parsed.at < 30_000
        ) {
          showToast(
            parsed.message,
            (parsed.kind as "success" | "error" | "info") || "success",
          );
        }
        sessionStorage.removeItem("admin:products:post-save-toast");
      }
    } catch {
      // sessionStorage / JSON parse failures are non-fatal.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the edit URL with the current list state forwarded as query
  // params. The edit page reads these and routes back here with them
  // after save / cancel, so the operator lands on the same row position.
  const buildListStateQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (filterCategory) params.set("category_id", filterCategory);
    if (filterStatus === "active") params.set("is_active", "true");
    else if (filterStatus === "inactive") params.set("is_active", "false");
    if (search) params.set("search", search);
    if (pageSize !== 20) params.set("limit", String(pageSize));
    return params.toString();
  }, [page, pageSize, filterCategory, filterStatus, search]);

  const buildEditHref = useCallback(
    (productId: string) => {
      const qs = buildListStateQuery();
      return qs
        ? `/admin/products/${productId}/edit?${qs}`
        : `/admin/products/${productId}/edit`;
    },
    [buildListStateQuery]
  );

  const buildNewHref = useCallback(() => {
    const qs = buildListStateQuery();
    return qs ? `/admin/products/new?${qs}` : "/admin/products/new";
  }, [buildListStateQuery]);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterCategory) params.set("category_id", filterCategory);
      if (filterStatus === "active") params.set("is_active", "true");
      if (filterStatus === "inactive") params.set("is_active", "false");
      params.set("page", String(page));
      params.set("limit", String(pageSize));

      const [productsRes, categoriesRes, inventoryRes, activeCountRes] = await Promise.all([
        fetch(`/api/admin/products?${params}`, { ...adminCred, signal }).then((r) => r.json()),
        fetch("/api/v1/categories", { signal }).then((r) => r.json()),
        fetch("/api/admin/inventory", { ...adminCred, signal }).then((r) => r.json()),
        // Use the same paginated endpoint with limit=1 just to read the
        // total — works because /api/admin/products returns a `pagination`
        // block with the unfiltered count of rows matching `is_active=true`.
        fetch("/api/admin/products?is_active=true&limit=1", { ...adminCred, signal }).then((r) => r.json()),
      ]);
      if (signal?.aborted) return;
      if (productsRes.success) {
        setProducts(productsRes.data || []);
        if (productsRes.pagination) setPagination(productsRes.pagination);
      }
      if (categoriesRes.success) setCategories(categoriesRes.data || []);
      if (inventoryRes.success) {
        setStats((prev) => ({
          ...prev,
          lowStock: inventoryRes.lowStockCount ?? (inventoryRes.lowStock || []).length,
          outOfStock: inventoryRes.outOfStockCount ?? (inventoryRes.outOfStock || []).length,
        }));
      }
      if (productsRes.success) {
        // When the "inactive" filter is on, every row on the page is
        // inactive; surface the pagination total so the operator sees
        // the real catalog-wide count rather than just one page.
        const inactiveTotal =
          filterStatus === "inactive"
            ? productsRes.pagination?.total ?? 0
            : 0;
        setStats((prev) => ({
          ...prev,
          inactive: inactiveTotal,
        }));
      }
      if (activeCountRes?.success) {
        // Catalog-wide active count from the server. Independent of the
        // current page / filters so the dashboard tile is accurate.
        setStats((prev) => ({
          ...prev,
          active: activeCountRes.pagination?.total ?? 0,
        }));
      }
    } catch (error) {
      if (!signal?.aborted) {
        console.error(error);
        showToast("فشل تحميل المنتجات", "error");
      }
    }
    if (!signal?.aborted) setLoading(false);
  };

  useEffect(() => {
    if (!hasRestored) return;
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, [hasRestored, page, pageSize, filterCategory, filterStatus]);

  // Debounce search
  useEffect(() => {
    if (!hasRestored) return;
    if (search === lastSearch.current) return;
    lastSearch.current = search;

    const t = setTimeout(() => {
      setPage(1);
      loadData();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRestored, search]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(products.map((p) => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBulkAction = async (action: string, value?: any) => {
    let message = "";
    if (action === "delete") message = "هل أنت متأكد من حذف المنتجات المحددة؟";
    else if (action === "update_status" && value === "active") message = "هل تريد تفعيل المنتجات المحددة؟";
    else if (action === "update_status" && value === "inactive") message = "هل تريد إخفاء المنتجات المحددة؟";
    
    if (message && !(await confirm({ title: "تأكيد الإجراء", message }))) return;

    try {
      setBulkActionLoading(true);
      const res = await csrfFetch("/api/admin/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds, value }),
        ...adminCred,
      }).then((r) => r.json());
      setBulkActionLoading(false);
      
      if (res.success) {
        showToast("تم تنفيذ الإجراء بنجاح", "success");
        setSelectedIds([]);
        if (action === "update_category") setShowCategoryModal(false);
        if (action === "update_quantity") setShowQuantityModal(false);
        loadData();
      } else {
        showToast(res.error || "فشل التنفيذ", "error");
      }
    } catch {
      setBulkActionLoading(false);
      showToast("فشل في الاتصال بالخادم", "error");
    }
  };

  const handleDelete = async (product: Product) => {
    if (!(await confirm({
      title: "حذف منتج",
      message: `هل أنت متأكد من حذف "${product.name_ar}"؟ لا يمكن التراجع.`,
      danger: true,
    }))) return;
    try {
      const res = await csrfFetch(`/api/admin/products?id=${product.id}`, {
        method: "DELETE",
        ...adminCred,
      });
      const result = await res.json();
      if (result.success) {
        showToast("تم حذف المنتج", "success");
        loadData();
      } else {
        showToast(result.error || "فشل الحذف", "error");
      }
    } catch {
      showToast("فشل في حذف المنتج", "error");
    }
  };

  const handleBulkActivate = async () => {
    if (
      !(await confirm({
        title: "تفعيل كل المنتجات المخفية",
        message:
          "سيتم تفعيل جميع المنتجات غير النشطة وعرضها في المتجر. هل تريد المتابعة؟",
        confirmLabel: "تفعيل الكل",
      }))
    )
      return;
    try {
      setBulkActivating(true);
      const res = await csrfFetch("/api/admin/products/bulk-activate", {
        method: "POST",
        ...adminCred,
      }).then((r) => r.json());
      setBulkActivating(false);
      if (res.success) {
        const count = res.data?.activated_count ?? 0;
        showToast(
          count > 0 ? `تم تفعيل ${count} منتج` : "لا توجد منتجات مخفية للتفعيل",
          "success",
        );
        // Refresh to reflect the new active state and reset the filter
        // so the operator lands on the full catalog.
        setFilterStatus("");
        setPage(1);
        loadData();
      } else {
        showToast(res.error || "فشل التفعيل الجماعي", "error");
      }
    } catch {
      setBulkActivating(false);
      showToast("فشل التفعيل الجماعي", "error");
    }
  };

  const stockBadge = (qty: number) => {
    if (qty === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700">
          <AlertTriangle className="w-3 h-3" /> نفد
        </span>
      );
    }
    if (qty <= LOW_STOCK_THRESHOLD) {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-100 text-amber-700">
          <AlertTriangle className="w-3 h-3" /> منخفض
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">
        {qty}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            إدارة المنتجات
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            أضف، عدّل، وتابع مخزون منتجات المتجر
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={buildNewHref()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-all shadow-sm hover:shadow-md active:scale-[0.98] admin-focus-ring"
          >
            <Plus className="w-4 h-4" />
            إضافة منتج
          </Link>
        </div>
      </div>

      {/* Stat counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 admin-hover-lift admin-press">
          <p className="text-xs text-gray-500">إجمالي المنتجات</p>
          <p className="text-2xl font-bold text-secondary mt-1">
            {pagination.total}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 admin-hover-lift admin-press">
          <p className="text-xs text-gray-500">نشطة</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {stats.active}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFilterStatus(filterStatus === "inactive" ? "" : "inactive");
            setPage(1);
          }}
          className={`bg-white rounded-xl border p-4 text-right transition-colors group ${
            stats.inactive > 0
              ? "border-amber-300 hover:border-amber-500"
              : "border-gray-100"
          } ${filterStatus === "inactive" ? "ring-2 ring-amber-300" : ""}`}
          aria-label="عرض المنتجات غير النشطة"
        >
          <p className={`text-xs flex items-center gap-1 ${stats.inactive > 0 ? "text-amber-700" : "text-gray-500"}`}>
            <EyeOff className="w-3 h-3" /> غير نشطة
          </p>
          <p
            className={`text-2xl font-bold mt-1 ${
              stats.inactive > 0 ? "text-amber-700" : "text-gray-400"
            }`}
          >
            {stats.inactive}
          </p>
        </button>
        <Link
          href="/admin/inventory"
          className="bg-white rounded-xl border border-red-200 p-4 hover:border-red-400 transition-colors group"
        >
          <p className="text-xs text-red-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> نفد المخزون
          </p>
          <p className="text-2xl font-bold text-red-700 mt-1 group-hover:underline">
            {stats.outOfStock}
          </p>
        </Link>
      </div>

      {/* Bulk activate banner — only when there are inactive products */}
      {stats.inactive > 0 && (
        <div className="flex items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              لديك <strong>{stats.inactive}</strong> منتج مخفي عن المتجر.
            </span>
          </div>
          <button
            type="button"
            onClick={handleBulkActivate}
            disabled={bulkActivating}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {bulkActivating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                جاري التفعيل...
              </>
            ) : (
              <>
                <Power className="w-4 h-4" />
                تفعيل الكل
              </>
            )}
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-primary/5 border border-primary/20 rounded-2xl animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-primary" />
            <span className="font-medium text-secondary text-sm">
              تم تحديد {selectedIds.length} منتج
            </span>
            <button
              onClick={() => setSelectedIds([])}
              className="p-1 hover:bg-gray-200/50 rounded-full text-gray-500 transition-colors me-2"
              title="إلغاء التحديد"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleBulkAction("delete")}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              حذف
            </button>
            <div className="h-4 w-px bg-gray-300 mx-1"></div>
            <button
              onClick={() => handleBulkAction("update_status", "active")}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white text-green-700 border border-green-200 rounded-lg hover:bg-green-50 disabled:opacity-50"
            >
              تفعيل
            </button>
            <button
              onClick={() => handleBulkAction("update_status", "inactive")}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              إخفاء
            </button>
            <div className="h-4 w-px bg-gray-300 mx-1"></div>
            <button
              onClick={() => setShowCategoryModal(true)}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white text-primary border border-primary/20 rounded-lg hover:bg-primary/5 disabled:opacity-50"
            >
              نقل لقسم
            </button>
            <button
              onClick={() => setShowQuantityModal(true)}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white text-primary border border-primary/20 rounded-lg hover:bg-primary/5 disabled:opacity-50"
            >
              تعديل الكمية
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الباركود..."
              className="w-full h-11 pe-10 ps-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:bg-white transition-colors"
            />
          </div>
          <div className="lg:w-56">
            <SearchableSelect
              value={filterCategory}
              onChange={(v) => {
                setFilterCategory(v);
                setPage(1);
              }}
              options={categories.map((c) => ({
                value: String(c.id),
                label: c.name_ar,
              }))}
              placeholder="كل الفئات"
              emptyText="لا توجد فئات مطابقة"
              ariaLabel="فلترة حسب الفئة"
            />
          </div>
          <div className="lg:w-48">
            <SearchableSelect
              value={filterStatus}
              onChange={(v) => {
                setFilterStatus(v);
                setPage(1);
              }}
              options={[
                { value: "active", label: "نشط" },
                { value: "inactive", label: "غير نشط" },
              ]}
              placeholder="كل الحالات"
              searchable={false}
              emptyText="لا توجد حالات"
              ariaLabel="فلترة حسب الحالة"
            />
          </div>
          <div className="lg:w-40">
            <SearchableSelect
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
              options={[10, 20, 50, 100].map((n) => ({
                value: String(n),
                label: `${n} لكل صفحة`,
              }))}
              placeholder="عدد لكل صفحة"
              searchable={false}
              emptyText="لا توجد خيارات"
              ariaLabel="عدد العناصر لكل صفحة"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {/*
        Force-rebuild the container on every URL change. The edit page
        forwards the saved list state (page / category_id / is_active /
        search / limit) via the query string and routes back here, so
        returning from edit lands on this same component — but we still
        want React to throw away the existing DOM tree and start fresh
        so the skeleton flashes, the table re-fetches, and any leftover
        state (scroll, focus, hover) from before the navigation is wiped.
        Without this key, fast navigation can leave the previous render
        in place until the new data arrives.
      */}
      <div
        key={`products-table-${searchParams.toString()}`}
        className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
      >
        {loading ? (
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3.5 animate-pulse"
              >
                <div className="w-12 h-12 rounded-lg bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 bg-gray-200 rounded" />
                  <div className="h-3 w-1/4 bg-gray-100 rounded" />
                </div>
                <div className="h-6 w-16 bg-gray-100 rounded-lg hidden sm:block" />
                <div className="h-6 w-20 bg-gray-100 rounded-lg hidden md:block" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Package className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700">
              لا توجد منتجات
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              ابدأ بإضافة أول منتج للمتجر
            </p>
            <Link
              href={buildNewHref()}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark"
            >
              <Plus className="w-4 h-4" />
              إضافة منتج
            </Link>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-right">
                      <input
                        type="checkbox"
                        checked={products.length > 0 && selectedIds.length === products.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">المنتج</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الفئة</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">السعر</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">المخزون</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const stock = Number(p.stock_qty) || 0;
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(p.id)}
                            onChange={() => toggleSelect(p.id)}
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                              {p.image_url ? (
                                <Image
                                  src={p.image_url}
                                  alt={p.name_ar}
                                  fill
                                  sizes="48px"
                                  className="object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Package className="w-5 h-5 text-gray-400" />
                                </div>
                              )}
                              {p.is_featured && (
                                <span className="absolute top-0.5 end-0.5 text-[9px] bg-amber-400 text-white px-1 rounded">
                                  ⭐
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-secondary truncate">
                                {p.name_ar}
                              </p>
                              {p.name_en && (
                                <p className="text-xs text-gray-400 truncate" dir="ltr">
                                  {p.name_en}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {p.category_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium text-secondary">
                            {Number(p.price).toFixed(2)} ر
                          </div>
                          {p.discount_price && (
                            <div className="text-xs text-red-600">
                              خصم: {Number(p.discount_price).toFixed(2)} ر
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">{stockBadge(stock)}</td>
                        <td className="px-4 py-3">
                          {p.is_active ? (
                            <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">
                              نشط
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700">
                              مخفي
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              href={buildEditHref(p.id)}
                              data-tip="تعديل"
                              className="admin-tooltip p-2 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              aria-label="تعديل"
                            >
                              <Pencil className="w-4 h-4" />
                            </Link>
                            <button
                              onClick={() => handleDelete(p)}
                              data-tip="حذف"
                              className="admin-tooltip p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              aria-label="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100">
              {products.map((p) => {
                const stock = Number(p.stock_qty) || 0;
                return (
                  <div key={p.id} className="p-4 space-y-2 relative">
                    <div className="absolute top-4 start-4 z-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        {p.image_url ? (
                          <Image
                            src={p.image_url}
                            alt={p.name_ar}
                            fill
                            sizes="56px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-5 h-5 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-secondary">
                          {p.name_ar}
                        </p>
                        <p className="text-xs text-gray-500">{p.category_name || "—"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-bold text-primary">
                            {Number(p.price).toFixed(2)} ر
                          </span>
                          {stockBadge(stock)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <Link
                        href={buildEditHref(p.id)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-primary bg-primary/10 rounded-lg"
                      >
                        <Pencil className="w-4 h-4" /> تعديل
                      </Link>
                      <button
                        onClick={() => handleDelete(p)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" /> حذف
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {pagination.total > 0 && (
              <Pagination
                page={page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                pageSize={pageSize}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                total={pagination.total}
                pageSizeOptions={[10, 20, 50, 100]}
              />
            )}
          </>
        )}
      </div>
      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-secondary mb-4">نقل المنتجات المحددة</h3>
            <div className="mb-4">
              <label className="block text-sm text-gray-500 mb-1">اختر القسم الجديد</label>
              <SearchableSelect
                value={bulkCategory}
                onChange={setBulkCategory}
                options={categories.map((c) => ({ value: String(c.id), label: c.name_ar }))}
                placeholder="اختر القسم..."
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkAction("update_category", bulkCategory)}
                disabled={bulkActionLoading || !bulkCategory}
                className="flex-1 bg-primary text-white py-2 rounded-xl text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
              >
                تأكيد النقل
              </button>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl text-sm font-medium hover:bg-gray-200"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quantity Modal */}
      {showQuantityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-secondary mb-4">تعديل المخزون للمنتجات المحددة</h3>
            <div className="mb-4">
              <label className="block text-sm text-gray-500 mb-1">الكمية الجديدة (تطبق على الكل)</label>
              <input
                type="number"
                value={bulkQuantity}
                onChange={(e) => setBulkQuantity(e.target.value)}
                min="0"
                className="w-full px-4 py-2 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-primary"
                placeholder="الكمية..."
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkAction("update_quantity", parseInt(bulkQuantity, 10))}
                disabled={bulkActionLoading || bulkQuantity === ""}
                className="flex-1 bg-primary text-white py-2 rounded-xl text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
              >
                حفظ المخزون
              </button>
              <button
                onClick={() => setShowQuantityModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl text-sm font-medium hover:bg-gray-200"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm.dialog}
    </div>
  );
}

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">جاري التحميل...</div>}>
      <ProductsPage />
    </Suspense>
  );
}
