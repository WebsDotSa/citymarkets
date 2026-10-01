"use client";

import { useEffect, useState, use, useMemo } from "react";
import Link from "next/link";
import {
  Tag,
  Plus,
  Loader2,
  FolderTree,
  Globe2,
  Lock,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";
import { useToast, useConfirm } from "@/components/ui/toast";
import { useVendorRole } from "../_lib/vendor-role-context";

interface CategoriesPageProps {
  params: Promise<{ slug: string }>;
}

interface Category {
  id: string;
  name_ar: string;
  name_en?: string | null;
  slug: string;
  parent_id?: string | null;
  is_active?: boolean;
  vendor_id?: string | null;
}

/**
 * Per-vendor categories management.
 *
 * Two scopes (since migration 081):
 *   - "تصنيفات عامة" — global rows from the shared `categories`
 *     table. Read-only here; admin team owns them.
 *   - "تصنيفاتي" — private rows scoped to this vendor
 *     (`vendor_id = current`). The vendor can rename or delete these.
 *
 * New categories default to PRIVATE (`isPrivate = true`). Creating a
 * global row still works (manager+) but is discouraged because it
 * affects every other vendor's storefront.
 */
export default function VendorCategoriesPage({ params }: CategoriesPageProps) {
  const { slug } = use(params);
  const { canDo, isReadOnly } = useVendorRole();
  const canManage = canDo("manage_categories");
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [globalCategories, setGlobalCategories] = useState<Category[]>([]);
  const [privateCategories, setPrivateCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  async function loadCategories() {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/vendor/categories", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const payload = data.data ?? {};
        setGlobalCategories(Array.isArray(payload.global) ? payload.global : []);
        setPrivateCategories(
          Array.isArray(payload.private) ? payload.private : [],
        );
      }
    } catch {
      /* ignore — keep empty list */
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nameAr.trim()) {
      setError("اسم القسم بالعربية مطلوب");
      return;
    }
    try {
      setCreating(true);
      const res = await csrfFetch("/api/v1/vendor/categories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || undefined,
          isPrivate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "تعذّر إنشاء القسم. حاول مرة أخرى.");
        return;
      }
      showToast(
        isPrivate
          ? "تم إنشاء القسم الخاص"
          : "تم إنشاء القسم العام — سيظهر لجميع المتاجر",
        "success",
      );
      setNameAr("");
      setNameEn("");
      loadCategories();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditNameAr(c.name_ar);
    setEditNameEn(c.name_en ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditNameAr("");
    setEditNameEn("");
  }

  async function saveEdit(c: Category) {
    if (!editNameAr.trim()) {
      showToast("الاسم بالعربية مطلوب", "error");
      return;
    }
    try {
      setSavingEdit(true);
      const res = await csrfFetch(`/api/v1/vendor/categories/${c.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameAr: editNameAr.trim(),
          nameEn: editNameEn.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل التحديث", "error");
        return;
      }
      showToast("تم تحديث القسم", "success");
      cancelEdit();
      loadCategories();
    } catch {
      showToast("تعذّر الاتصال بالخادم", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(c: Category) {
    const ok = await confirm({
      title: "حذف القسم",
      message: `حذف القسم "${c.name_ar}"؟ المنتجات المرتبطة ستبقى ظاهرة بدون تصنيف.`,
      danger: true,
    });
    if (!ok) return;
    try {
      setDeletingId(c.id);
      const res = await csrfFetch(`/api/v1/vendor/categories/${c.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل الحذف", "error");
        return;
      }
      showToast("تم حذف القسم", "success");
      loadCategories();
    } catch {
      showToast("تعذّر الاتصال بالخادم", "error");
    } finally {
      setDeletingId(null);
    }
  }

  const sortedGlobal = useMemo(
    () =>
      [...globalCategories].sort((a, b) =>
        a.name_ar.localeCompare(b.name_ar, "ar"),
      ),
    [globalCategories],
  );
  const sortedPrivate = useMemo(
    () =>
      [...privateCategories].sort((a, b) =>
        a.name_ar.localeCompare(b.name_ar, "ar"),
      ),
    [privateCategories],
  );

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FolderTree className="w-6 h-6 text-primary" />
          الأقسام
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          أضف تصنيفات خاصة بمتجرك تظهر للزبائن على واجهة متجرك فقط.
          التصنيفات العامة يديرها فريق الإدارة وتظهر لجميع المتاجر.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          بعد إنشاء القسم، اذهب إلى{" "}
          <Link
            href={`/vendor/${slug}/admin/products`}
            className="text-primary underline underline-offset-2 hover:text-primaryDark font-medium"
          >
            صفحة المنتجات
          </Link>{" "}
          لتعيينه على المنتج.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          إضافة قسم جديد
        </h2>
        {isReadOnly && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            وضع القراءة فقط — لا يمكنك إنشاء أقسام بهذه الصلاحية.
          </div>
        )}
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label
              htmlFor="nameAr"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              الاسم بالعربية
              <span className="text-red-500 ms-1">*</span>
            </label>
            <input
              id="nameAr"
              type="text"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="تمور فاخرة"
              maxLength={120}
            />
          </div>
          <div>
            <label
              htmlFor="nameEn"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              الاسم بالإنجليزية (اختياري)
            </label>
            <input
              id="nameEn"
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Premium Dates"
              dir="ltr"
              maxLength={120}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span className="flex items-center gap-1.5">
              {isPrivate ? (
                <Lock className="w-3.5 h-3.5 text-amber-600" />
              ) : (
                <Globe2 className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span>
                {isPrivate
                  ? "تصنيف خاص بهذا المتجر (يظهر لك فقط)"
                  : "تصنيف عام (يظهر لجميع المتاجر)"}
              </span>
            </span>
          </label>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={creating || !nameAr.trim() || !canManage}
            title={canManage ? undefined : "ليس لديك صلاحية لإنشاء أقسام"}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primaryDark transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري الإنشاء…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                إضافة القسم
              </>
            )}
          </button>
        </form>
      </div>

      {/* PRIVATE — editable */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-600" />
          تصنيفاتي ({sortedPrivate.length})
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          تظهر هذه الأقسام في صفحة متجرك فقط، ولا تظهر للمتاجر الأخرى.
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : sortedPrivate.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            لم تنشئ أي قسم خاص بعد.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedPrivate.map((c) =>
              editingId === c.id ? (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-3 w-full sm:w-auto sm:min-w-[280px]"
                >
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={editNameAr}
                      onChange={(e) => setEditNameAr(e.target.value)}
                      placeholder="الاسم بالعربية"
                      aria-label="الاسم بالعربية"
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      aria-label="إلغاء"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editNameEn}
                    onChange={(e) => setEditNameEn(e.target.value)}
                    placeholder="الاسم بالإنجليزية (اختياري)"
                    aria-label="الاسم بالإنجليزية (اختياري)"
                    dir="ltr"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(c)}
                      disabled={savingEdit}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primaryDark transition disabled:opacity-50"
                    >
                      {savingEdit ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Pencil className="w-3 h-3" />
                      )}
                      حفظ
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 pl-2 pr-3 py-1.5 text-sm text-amber-900"
                  title={c.slug}
                >
                  <Lock className="w-3 h-3 text-amber-600" aria-hidden />
                  <span className="font-medium">{c.name_ar}</span>
                  {c.name_en && (
                    <span className="text-amber-700/70 text-xs" dir="ltr">
                      · {c.name_en}
                    </span>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="ms-1 p-0.5 rounded-md text-amber-700/70 hover:text-amber-900 hover:bg-amber-100"
                        aria-label="تعديل"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                        className="p-0.5 rounded-md text-red-600 hover:text-red-800 hover:bg-red-50 disabled:opacity-50"
                        aria-label="حذف"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* GLOBAL — read-only */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-blue-600" />
          التصنيفات العامة ({sortedGlobal.length})
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          هذه التصنيفات يديرها فريق الإدارة وتظهر لجميع المتاجر.
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : sortedGlobal.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            لا توجد تصنيفات عامة.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedGlobal.map((c) => (
              <div
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                title={c.slug}
              >
                <Globe2 className="w-3.5 h-3.5 text-blue-500" aria-hidden />
                <span className="font-medium">{c.name_ar}</span>
                {c.name_en && (
                  <span className="text-slate-400 text-xs" dir="ltr">
                    · {c.name_en}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {confirm.dialog}
    </div>
  );
}
