"use client";

import { useEffect, useState, use, useMemo } from "react";
import Link from "next/link";
import { Tag, Plus, Loader2, FolderTree } from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";

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
}

/**
 * Per-vendor categories management.
 *
 * Categories are global (one `categories` table, no vendor scope) per
 * the operator decision (2026-09-23). This page gives vendors a read-
 * only chip list of every category plus a "create new" form so a
 * vendor that needs to launch a new product type doesn't have to wait
 * on the admin team.
 *
 * Update/delete are intentionally absent — editing a category would
 * silently affect everyone else's storefront, which is outside the
 * per-vendor editing perimeter set by the rest of the vendor admin.
 */
export default function VendorCategoriesPage({ params }: CategoriesPageProps) {
  const { slug } = use(params);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
        setCategories(Array.isArray(data.data) ? data.data : []);
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
    setSuccess(null);
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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "تعذّر إنشاء القسم. حاول مرة أخرى.");
        return;
      }
      setSuccess(`تم إنشاء القسم: ${data.data?.slug ?? nameAr}`);
      setNameAr("");
      setNameEn("");
      // Refresh the list so the new chip shows up immediately.
      loadCategories();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setCreating(false);
    }
  }

  // Sorted copy for stable rendering (the API already sorts, but the
  // freshly-inserted row may land at the tail depending on backend
  // ordering).
  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) =>
        a.name_ar.localeCompare(b.name_ar, "ar"),
      ),
    [categories],
  );

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FolderTree className="w-6 h-6 text-primary" />
          الأقسام
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          إضافة قسم جديد لمتجرك. الأقسام عامة وتظهر لجميع المتاجر
          والعملاء — لا يمكن لمتجر تعديل أو حذف قسم أنشأه متجر آخر.
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
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}
          <button
            type="submit"
            disabled={creating || !nameAr.trim()}
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

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary" />
          الأقسام الحالية ({sortedCategories.length})
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : sortedCategories.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            لا توجد أقسام حالياً.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedCategories.map((c) => (
              <div
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                title={c.slug}
              >
                <Tag className="w-3.5 h-3.5 text-slate-400" aria-hidden />
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
    </div>
  );
}
