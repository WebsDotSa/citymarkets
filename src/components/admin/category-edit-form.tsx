"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Save,
  FolderTree,
  EyeOff,
  Eye,
  Info,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import {
  isCategoryImageUrl,
  resolveCategoryImageSrc,
} from '@/lib/catalog';
import { generateSlug } from "@/lib/slug";

export interface CategoryFormValues {
  id?: string;
  name_ar: string;
  name_en?: string;
  slug: string;
  icon_url: string;
  sort_order: number;
  parent_id?: string | null;
  is_active?: boolean;
  description_ar?: string;
  description_en?: string;
  parent_name_ar?: string | null;
}

interface ParentOption {
  id: string;
  name_ar: string;
}

interface CategoryEditFormProps {
  mode: "create" | "edit";
  initial: CategoryFormValues;
  parentOptions: ParentOption[];
  backHref?: string;
  onSubmit: (data: CategoryFormValues) => Promise<boolean>;
}

export function CategoryEditForm({
  mode,
  initial,
  parentOptions,
  backHref = "/admin/categories",
  onSubmit,
}: CategoryEditFormProps) {
  const [nameAr, setNameAr] = useState(initial.name_ar || "");
  const [nameEn, setNameEn] = useState(initial.name_en || "");
  const [slug, setSlug] = useState(initial.slug || "");
  const [sortOrder, setSortOrder] = useState(initial.sort_order ?? 0);
  const [parentId, setParentId] = useState<string>(initial.parent_id || "");
  const [isActive, setIsActive] = useState(initial.is_active !== false);
  const [descriptionAr, setDescriptionAr] = useState(
    initial.description_ar || ""
  );
  const [descriptionEn, setDescriptionEn] = useState(
    initial.description_en || ""
  );
  const [imageUrl, setImageUrl] = useState(
    isCategoryImageUrl(initial.icon_url) ? initial.icon_url : ""
  );
  const [iconKey, setIconKey] = useState(
    initial.icon_url && !isCategoryImageUrl(initial.icon_url)
      ? initial.icon_url
      : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const previewSrc = resolveCategoryImageSrc(imageUrl);

  // Auto-suggest a slug from name_ar when slug is empty (only on create or
  // when user hasn't typed one yet).
  const slugAuto = useMemo(() => {
    return generateSlug(nameAr || "");
  }, [nameAr]);

  const isSubCategory = !!parentId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!nameAr.trim()) {
      setError("اسم الفئة بالعربية مطلوب");
      return;
    }

    let finalSlug =
      slug.trim() ||
      (mode === "create" ? slugAuto : generateSlug(nameAr));

    // If somehow empty, fallback to a safe default
    if (!finalSlug) finalSlug = "category";

    const icon_url = imageUrl.trim() || iconKey.trim() || "";

    setSubmitting(true);
    const ok = await onSubmit({
      id: initial.id,
      name_ar: nameAr.trim(),
      name_en: nameEn.trim() || undefined,
      slug: finalSlug,
      icon_url,
      sort_order: Number(sortOrder) || 0,
      parent_id: parentId || null,
      is_active: isActive,
      description_ar: descriptionAr.trim() || undefined,
      description_en: descriptionEn.trim() || undefined,
    });
    setSubmitting(false);
    if (!ok) setError("فشل حفظ الفئة. تحقق من البيانات وحاول مرة أخرى.");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        العودة للفئات
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
            <FolderTree className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-secondary">
              {mode === "edit" ? "تعديل الفئة" : "إضافة فئة جديدة"}
            </h1>
            <p className="text-sm text-gray-500">
              {mode === "edit"
                ? initial.name_ar
                : "أضف تصنيفاً جديداً مع صورة تظهر في المتجر"}
            </p>
          </div>
          {/* Active toggle in header for visibility */}
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              isActive
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-gray-100 text-gray-500 border border-gray-200"
            }`}
            aria-pressed={isActive}
            aria-label={isActive ? "الفئة مفعّلة (اضغط للإخفاء)" : "الفئة مخفية (اضغط للتفعيل)"}
          >
            {isActive ? (
              <>
                <Eye className="w-4 h-4" />
                مفعّلة
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" />
                مخفية
              </>
            )}
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Image uploader */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              صورة الفئة
            </label>
            <ImageUploader
              value={imageUrl}
              onChange={setImageUrl}
              folder="categories"
              placeholder="اضغط لرفع صورة الفئة (مربعة أو أفقية)"
              aspectRatio="aspect-square"
            />
            <p className="text-xs text-gray-400 mt-2">
              تُعرض في الصفحة الرئيسية وصفحة التصنيفات. يُفضّل صورة بخلفية شفافة أو
              بيضاء.
            </p>
          </div>

          {previewSrc && (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-primary-light/50 border border-primary/10">
              <div className="w-20 h-20 rounded-xl overflow-hidden bg-white border border-gray-100 flex-shrink-0">
                <img
                  src={previewSrc}
                  alt="معاينة"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  معاينة في المتجر
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  كما ستظهر في بطاقة التصنيف
                </p>
              </div>
            </div>
          )}

          {/* Name + Slug + Parent row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                اسم الفئة بالعربية <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: فواكه وخضروات"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                اسم الفئة بالإنجليزية
              </label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Fruits & Vegetables"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                القسم الأب (اختياري)
              </label>
              <SearchableSelect
                value={parentId}
                onChange={setParentId}
                options={parentOptions.map((p) => ({ value: p.id, label: p.name_ar }))}
                placeholder="— قسم رئيسي (بدون أب) —"
                disabled={mode === "edit" && initial.parent_name_ar ? true : false}
              />
              <p className="text-xs text-gray-400 mt-1">
                {isSubCategory
                  ? "سيظهر كقسم فرعي تحت القسم المختار"
                  : "اتركه فارغاً ليظهر كقسم رئيسي في الصفحة الرئيسية"}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                الرابط (Slug)
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={slugAuto || "fruits-vegetables"}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
              <p className="text-xs text-gray-400 mt-1">
                يُستخدم في الرابط. يُولّد تلقائياً من الاسم إذا تُرك فارغاً.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ترتيب العرض
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(parseInt(e.target.value, 10) || 0)
                }
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                الأرقام الأصغر تظهر أولاً
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                مفتاح أيقونة قديم (اختياري)
              </label>
              <input
                type="text"
                value={iconKey}
                onChange={(e) => setIconKey(e.target.value)}
                placeholder="coffee — يُستخدم فقط إذا لم ترفع صورة"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
            </div>
          </div>

          {/* Descriptions */}
          <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                وصف القسم (عربي)
              </label>
              <textarea
                value={descriptionAr}
                onChange={(e) => setDescriptionAr(e.target.value)}
                placeholder="يظهر في صفحة القسم، اختياري لتحسين SEO"
                rows={3}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                وصف القسم (إنجليزي)
              </label>
              <textarea
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                placeholder="Shown on the category page, optional SEO copy"
                rows={3}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                dir="ltr"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
          <Link
            href={backHref}
            className="px-6 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-white transition-colors"
          >
            إلغاء
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                حفظ الفئة
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}