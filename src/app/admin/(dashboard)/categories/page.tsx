"use client";

import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CategoryThumb } from "@/components/admin/category-thumb";
import {
  FolderTree,
  Plus,
  Edit2,
  Trash2,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  Package,
  Eye,
  EyeOff,
  Save,
  Filter,
  Folder,
  FolderOpen,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";
import { resolveCategoryImageSrc } from "@/lib/category-media";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from "@/lib/api";
import type { AdminCategory } from "@/lib/admin-types";

const adminCred = { credentials: "include" as const };

type CategoryRow = AdminCategory;

export default function AdminCategoriesPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parentFilter, setParentFilter] = useState<string>(""); // "" = all
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [deleteConfirm, setDeleteConfirm] = useState<CategoryRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  // Reset move-target whenever a new delete is opened so the dropdown
  // starts on a sane default each time.
  useEffect(() => {
    if (deleteConfirm) {
      // Pre-select the first non-self, non-descendant root category as a
      // sensible default for the move-to dropdown.
      const candidates = categories.filter((c) => c.id !== deleteConfirm.id);
      setMoveTarget(candidates[0]?.id ?? "");
    }
  }, [deleteConfirm, categories]);

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, []);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch<CategoryRow[]>("/api/admin/categories", { signal });
      if (signal?.aborted) return;
      if (res.success) {
        setCategories(res.data || []);
      }
    } catch (error) {
      if (!signal?.aborted) console.error(error);
    }
    if (!signal?.aborted) setLoading(false);
  };

  const handleDelete = async (
    id: string,
    options: { withProducts?: boolean; moveTo?: string | null } = {}
  ) => {
    setDeleting(true);
    try {
      const params = new URLSearchParams({ id });
      if (options.withProducts) params.set("with_products", "true");
      if (options.moveTo) params.set("move_to", options.moveTo);

      const res = await csrfFetch(`/api/admin/categories?${params.toString()}`, {
        method: "DELETE",
        ...adminCred,
      });
      const json = await res.json();
      if (json.success) {
        setCategories((cats) => cats.filter((c) => c.id !== id));
        setDeleteConfirm(null);
        // Build a confirmation toast that reflects what the API actually did.
        const moved = json.data?.movedProducts as number | undefined;
        const deleted = json.data?.deletedProducts as number | undefined;
        const cleanedImgs = json.data?.deletedImages as number | undefined;
        let msg = "تم حذف الفئة";
        if (moved) msg += ` ونقل ${moved} منتج`;
        else if (deleted) msg += ` مع ${deleted} منتج`;
        if (cleanedImgs) msg += ` وتنظيف ${cleanedImgs} صورة`;
        showToast(msg, "success");
      } else {
        showToast(json.error || "فشل الحذف", "error");
      }
    } catch (error) {
      showToast("فشل في حذف الفئة", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (cat: CategoryRow) => {
    // Optimistic update
    setCategories((cats) =>
      cats.map((c) =>
        c.id === cat.id ? { ...c, is_active: !c.is_active } : c
      )
    );
    try {
      const res = await csrfFetch(`/api/admin/categories?id=${cat.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cat,
          is_active: !cat.is_active,
        }),
        ...adminCred,
      });
      const json = await res.json();
      if (!json.success) {
        // Revert on failure
        setCategories((cats) =>
          cats.map((c) =>
            c.id === cat.id ? { ...c, is_active: cat.is_active } : c
          )
        );
        showToast(json.error || "فشل تحديث الحالة", "error");
      }
    } catch (error) {
      // Revert on error
      setCategories((cats) =>
        cats.map((c) =>
          c.id === cat.id ? { ...c, is_active: cat.is_active } : c
        )
      );
    }
  };

  // Build hierarchical structure
  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );

  const getChildren = (parentId: string) =>
    categories.filter((c) => c.parent_id === parentId);

  // Apply filters
  const filtered = useMemo(() => {
    let list = categories;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name_ar.toLowerCase().includes(q) ||
          (c.name_en || "").toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q)
      );
    }
    if (parentFilter === "__root__") {
      list = list.filter((c) => !c.parent_id);
    } else if (parentFilter) {
      list = list.filter((c) => c.parent_id === parentFilter);
    }
    if (statusFilter === "active") {
      list = list.filter((c) => c.is_active);
    } else if (statusFilter === "inactive") {
      list = list.filter((c) => !c.is_active);
    }
    return list;
  }, [categories, search, parentFilter, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = categories.length;
    const active = categories.filter((c) => c.is_active).length;
    const roots = categories.filter((c) => !c.parent_id).length;
    const subs = categories.filter((c) => c.parent_id).length;
    return { total, active, inactive: total - active, roots, subs };
  }, [categories]);

  return (
    <>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
              <FolderTree className="w-6 h-6 text-primary" />
              إدارة الفئات
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              أضف الأقسام الرئيسية والفرعية، ارفع صور، وحدد حالة الظهور
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/products?new=1"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white text-sm font-medium rounded-xl hover:bg-secondary/90 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              إضافة منتج
            </Link>
            <Link
              href="/admin/categories/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              إضافة فئة جديدة
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">إجمالي الفئات</p>
            <p className="text-2xl font-bold text-secondary mt-1">
              {stats.total}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">أقسام رئيسية</p>
            <p className="text-2xl font-bold text-primary mt-1">
              {stats.roots}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">أقسام فرعية</p>
            <p className="text-2xl font-bold text-secondary mt-1">
              {stats.subs}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">مفعّلة / مخفية</p>
            <p className="text-lg font-bold text-green-700 mt-1">
              {stats.active} <span className="text-gray-400 mx-1">/</span>{" "}
              <span className="text-gray-500">{stats.inactive}</span>
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ابحث بالاسم أو الـ slug..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pr-9 pl-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select
            value={parentFilter}
            onChange={(e) => setParentFilter(e.target.value)}
            className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">كل الأقسام</option>
            <option value="__root__">الأقسام الرئيسية فقط</option>
            {rootCategories.map((p) => (
              <option key={p.id} value={p.id}>
                تابع لـ: {p.name_ar}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | "active" | "inactive")
            }
            className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">كل الحالات</option>
            <option value="active">مفعّلة فقط</option>
            <option value="inactive">مخفية فقط</option>
          </select>
        </div>

        {/* List / Tree */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <FolderTree className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">لا توجد فئات تطابق البحث</p>
              {categories.length === 0 && (
                <Link
                  href="/admin/categories/new"
                  className="inline-flex items-center gap-2 mt-4 text-primary text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  أضف فئتك الأولى
                </Link>
              )}
            </div>
          ) : (
            <CategoryListView
              filtered={filtered}
              categories={categories}
              getChildren={getChildren}
              onDelete={(cat) => setDeleteConfirm(cat)}
              onToggleActive={handleToggleActive}
              search={search.trim().toLowerCase()}
            />
          )}
        </div>

      {/* Delete confirm modal — smart variants based on product count */}
      {deleteConfirm && (
        <DeleteCategoryDialog
          cat={deleteConfirm}
          categories={categories}
          moveTarget={moveTarget}
          onMoveTargetChange={setMoveTarget}
          deleting={deleting}
          onCancel={() => {
            if (deleting) return;
            setDeleteConfirm(null);
          }}
          onSimpleDelete={() => handleDelete(deleteConfirm.id)}
          onCascadeDelete={() =>
            handleDelete(deleteConfirm.id, { withProducts: true })
          }
          onMoveAndDelete={() =>
            handleDelete(deleteConfirm.id, { moveTo: moveTarget })
          }
        />
      )}
    </>
  );
}
// ===== List rendering component =====
function CategoryListView({
  filtered,
  categories,
  getChildren,
  onDelete,
  onToggleActive,
  search,
}: {
  filtered: CategoryRow[];
  categories: CategoryRow[];
  getChildren: (parentId: string) => CategoryRow[];
  onDelete: (cat: CategoryRow) => void;
  onToggleActive: (cat: CategoryRow) => void;
  search: string;
}) {
  // If filtering is active, render flat list. Otherwise render hierarchical.
  const hasFilter =
    search.length > 0 ||
    filtered.length !== categories.length;

  if (hasFilter) {
    return (
      <div className="divide-y divide-gray-100">
        {filtered.map((c) => (
          <CategoryRowView
            key={c.id}
            cat={c}
            depth={0}
            onDelete={onDelete}
            onToggleActive={onToggleActive}
          />
        ))}
      </div>
    );
  }

  // Hierarchical: render every descendant with its depth indentation
  const roots = categories.filter((c) => !c.parent_id);
  const renderBranch = (category: CategoryRow, depth: number): ReactNode => (
    <div key={category.id}>
      <CategoryRowView
        cat={category}
        depth={depth}
        onDelete={onDelete}
        onToggleActive={onToggleActive}
      />
      {getChildren(category.id).map((child) => renderBranch(child, depth + 1))}
    </div>
  );

  return <div className="divide-y divide-gray-100">{roots.map((root) => renderBranch(root, 0))}</div>;
}

function CategoryRowView({
  cat,
  depth,
  onDelete,
  onToggleActive,
}: {
  cat: CategoryRow;
  depth: number;
  onDelete: (cat: CategoryRow) => void;
  onToggleActive: (cat: CategoryRow) => void;
}) {
  const isChild = depth > 0;
  const img = resolveCategoryImageSrc(cat.effective_icon_url || cat.icon_url);

  return (
    <div className={`flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors ${!cat.is_active ? "opacity-60 bg-gray-50/50" : ""}`} style={{ paddingRight: `${12 + depth * 32}px` }}>
      {/* Indent marker */}
      {isChild ? (
        <div className="flex items-center text-gray-300">
          <span className="inline-block w-4 h-px bg-gray-300 ml-1" />
          <FolderOpen className="w-4 h-4" />
        </div>
      ) : (
        <Folder className="w-4 h-4 text-gray-400 flex-shrink-0" />
      )}

      {/* Thumbnail */}
      <CategoryThumb
        iconUrl={img}
        name={cat.name_ar}
        className="w-12 h-12"
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-secondary truncate">
            {cat.name_ar}
          </h3>
          {!cat.is_active && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
              <EyeOff className="w-3 h-3" />
              مخفية
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
          <span className="font-mono" dir="ltr">
            /{cat.slug}
          </span>
          {cat.parent_name_ar && (
            <span className="text-primary">
              ← {cat.parent_name_ar}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Package className="w-3 h-3" />
            {cat.product_count} منتج
          </span>
          {cat.child_count > 0 && (
            <span className="flex items-center gap-1 text-primary">
              <FolderTree className="w-3 h-3" />
              {cat.child_count} فرعي
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onToggleActive(cat)}
          title={cat.is_active ? "إخفاء الفئة" : "إظهار الفئة"}
          className={`p-2 rounded-lg transition-colors ${
            cat.is_active
              ? "text-green-600 hover:bg-green-50"
              : "text-gray-400 hover:bg-gray-100"
          }`}
        >
          {cat.is_active ? (
            <Eye className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
        </button>
        <Link
          href={`/admin/categories/${cat.id}/edit`}
          className="p-2 text-gray-500 hover:text-primary hover:bg-primary-light rounded-lg transition-colors"
          title="تعديل"
        >
          <Edit2 className="w-4 h-4" />
        </Link>
        <button
          onClick={() => onDelete(cat)}
          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="حذف"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ===== Delete confirmation dialog =====
//
// Renders one of two layouts depending on whether the category has
// products attached:
//
//   - product_count === 0  → simple confirm, single delete button.
//   - product_count  >  0  → two options:
//       (A) move the products to another category, then delete
//       (B) delete the category along with all its products (cascade)
//
// The cascade branch is reserved for the danger style (red) because it
// cannot be undone. The move branch is the safe default for cases where
// the admin wants to retire the category but keep the catalog alive.
function DeleteCategoryDialog({
  cat,
  categories,
  moveTarget,
  onMoveTargetChange,
  deleting,
  onCancel,
  onSimpleDelete,
  onCascadeDelete,
  onMoveAndDelete,
}: {
  cat: CategoryRow;
  categories: CategoryRow[];
  moveTarget: string;
  onMoveTargetChange: (id: string) => void;
  deleting: boolean;
  onCancel: () => void;
  onSimpleDelete: () => void;
  onCascadeDelete: () => void;
  onMoveAndDelete: () => void;
}) {
  const hasProducts = cat.product_count > 0;

  // Compute descendant ids so we can hide them from the move-to
  // dropdown. The API rejects cycles too, but a filtered dropdown
  // makes the choice obvious.
  const descendantIds = useMemo(() => {
    const out = new Set<string>();
    const queue = [cat.id];
    while (queue.length) {
      const next = queue.shift()!;
      for (const c of categories) {
        if (c.parent_id === next && !out.has(c.id)) {
          out.add(c.id);
          queue.push(c.id);
        }
      }
    }
    return out;
  }, [categories, cat.id]);

  const moveCandidates = useMemo(
    () =>
      categories.filter(
        (c) => c.id !== cat.id && !descendantIds.has(c.id) && c.is_active,
      ),
    [categories, cat.id, descendantIds],
  );

  return (
    <div
      className="fixed inset-0 z-[1100] bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {hasProducts ? (
          <>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-secondary">
                  حذف فئة مرتبطة بـ {cat.product_count} منتج
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  فئة <span className="font-semibold">{cat.name_ar}</span>{" "}
                  تحتوي على منتجات. اختر الطريقة المناسبة قبل المتابعة.
                </p>
              </div>
            </div>

            {/* Option A: move products to another category */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <ArrowRightLeft className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm text-secondary">
                  انقل المنتجات لقسم آخر ثم احذف القسم
                </h4>
              </div>
              <p className="text-xs text-gray-600 mb-3">
                سيتم تغيير الفئة لجميع المنتجات المرتبطة إلى القسم المختار،
                ثم حذف هذا القسم. يحافظ على المنتجات في المتجر.
              </p>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                القسم المستهدف
              </label>
              <select
                value={moveTarget}
                onChange={(e) => onMoveTargetChange(e.target.value)}
                disabled={deleting || moveCandidates.length === 0}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
              >
                {moveCandidates.length === 0 && (
                  <option value="">لا توجد فئات متاحة</option>
                )}
                {moveCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                    {c.parent_name_ar ? ` (تابع لـ ${c.parent_name_ar})` : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={onMoveAndDelete}
                disabled={
                  deleting || !moveTarget || moveCandidates.length === 0
                }
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    جارٍ النقل والحذف...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    نقل {cat.product_count} منتج ثم حذف القسم
                  </>
                )}
              </button>
            </div>

            {/* Option B: cascade delete everything */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 className="w-4 h-4 text-red-600" />
                <h4 className="font-semibold text-sm text-red-700">
                  احذف القسم مع منتجاته (إجراء خطير)
                </h4>
              </div>
              <p className="text-xs text-red-700 mb-3">
                يحذف القسم وجميع المنتجات المرتبطة به بشكل نهائي، بما في ذلك
                صور المنتجات. لا يمكن التراجع.
              </p>
              <button
                onClick={onCascadeDelete}
                disabled={deleting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    جارٍ الحذف...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    احذف القسم مع {cat.product_count} منتج
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-secondary mb-2">
              تأكيد الحذف
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              هل أنت متأكد من حذف الفئة{" "}
              <span className="font-semibold">{cat.name_ar}</span>؟ لن تستطيع
              التراجع.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={onSimpleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "جارٍ الحذف..." : "حذف"}
              </button>
            </div>
          </>
        )}

        {hasProducts && (
          <div className="flex justify-start">
            <button
              onClick={onCancel}
              disabled={deleting}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        )}
      </div>
    </div>
  );
}