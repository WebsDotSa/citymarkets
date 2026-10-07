"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Save,
  Package,
  Image as ImageIcon,
  Eye,
  EyeOff,
  AlertTriangle,
  Info,
  Star,
  Plus,
  X,
  Loader2,
  Upload,
  Barcode,
  Tag,
  Layers,
  GripVertical,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/image-uploader";
import { PreviewButton } from "@/components/admin/preview-button";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { csrfFetch } from "@/lib/csrf-client";
import { compressImageForUpload } from "@/lib/image-compress";
import { ProductCard } from "@/components/storefront/product-card";

// Shown when a stored image URL 404s (e.g. missing CDN object).
const PLACEHOLDER_SRC = "/placeholders/products/default.svg";

export interface ProductFormValues {
  id?: string;
  name_ar: string;
  name_en?: string;
  barcode?: string;
  description?: string;
  category_id: string;
  price: number | string;
  discount_price?: number | string | null;
  stock_qty: number | string;
  unit?: string;
  image_url?: string | null;
  images?: string[];
  is_featured?: boolean;
  is_active?: boolean;
}

interface CategoryOption {
  id: string;
  name_ar: string;
}

interface ProductEditFormProps {
  mode: "create" | "edit";
  initial: ProductFormValues;
  categoryOptions: CategoryOption[];
  backHref?: string;
  onSubmit: (data: ProductFormValues) => Promise<boolean>;
}

const UNIT_OPTIONS = [
  "حبة",
  "كيلو",
  "جرام",
  "علبة",
  "كرتون",
  "لتر",
  "مل",
  "ربطة",
  "كيس",
  "قطعة",
];

export function ProductEditForm({
  mode,
  initial,
  categoryOptions,
  backHref = "/admin/products",
  onSubmit,
}: ProductEditFormProps) {
  const [nameAr, setNameAr] = useState(initial.name_ar || "");
  const [nameEn, setNameEn] = useState(initial.name_en || "");
  const [barcode, setBarcode] = useState(initial.barcode || "");
  const [description, setDescription] = useState(initial.description || "");
  const [categoryId, setCategoryId] = useState(initial.category_id || "");
  const [price, setPrice] = useState<string>(
    initial.price != null ? String(initial.price) : ""
  );
  const [discountPrice, setDiscountPrice] = useState<string>(
    initial.discount_price != null ? String(initial.discount_price) : ""
  );
  const [stockQty, setStockQty] = useState<string>(
    initial.stock_qty != null ? String(initial.stock_qty) : "0"
  );
  const [unit, setUnit] = useState(initial.unit || "حبة");
  const [imageUrl, setImageUrl] = useState(initial.image_url || "");
  const [gallery, setGallery] = useState<string[]>(initial.images || []);
  const [isFeatured, setIsFeatured] = useState(!!initial.is_featured);
  const [isActive, setIsActive] = useState(initial.is_active !== false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [galleryError, setGalleryError] = useState("");

  const discountValid = useMemo(() => {
    if (!discountPrice) return true;
    const d = parseFloat(discountPrice);
    const p = parseFloat(price);
    return !isNaN(d) && !isNaN(p) && d > 0 && d < p;
  }, [discountPrice, price]);

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setGalleryError("");
    setUploadingGallery(true);
    try {
      const uploaded: string[] = [];
      for (const original of Array.from(files)) {
        if (!original.type.startsWith("image/")) {
          setGalleryError("جميع الملفات يجب أن تكون صوراً");
          continue;
        }
        if (original.size > 10 * 1024 * 1024) {
          setGalleryError("حجم كل صورة يجب ألا يتجاوز 10MB");
          continue;
        }
        // Resize client-side so the request body fits the 30 s timeout
        // even on slow connections (the previous behaviour). See
        // image-uploader.tsx for the full pipeline.
        const file = await compressImageForUpload(original);
        const formData = new FormData();
        formData.append("image", file, file.name);
        formData.append("folder", "products");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        const res = await csrfFetch("/api/admin/upload", {
          method: "POST",
          body: formData,
          signal: controller.signal,
          credentials: "include",
        });
        clearTimeout(timeoutId);
        const result = await res.json();
        if (result.success) {
          uploaded.push(result.data.url);
        } else {
          setGalleryError(result.error || "فشل رفع إحدى الصور");
        }
      }
      if (uploaded.length > 0) {
        setGallery((prev) => [...prev, ...uploaded].slice(0, 8));
      }
    } catch (e) {
      setGalleryError("فشل رفع الصور");
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryImage = (idx: number) => {
    setGallery((prev) => prev.filter((_, i) => i !== idx));
  };

  // Promote a gallery image to the main image (slot 0) and demote the
  // current main to its old position. Mirrors the inline click affordance
  // documented in the helper text below the gallery.
  const promoteGalleryImage = (idx: number) => {
    if (idx <= 0) return;
    setGallery((prev) => {
      const next = [...prev];
      const [picked] = next.splice(idx, 1);
      next.unshift(picked);
      return next;
    });
  };

  // HTML5-native reorder. We track the source/destination via state
  // because dataTransfer payload can't be trusted across browsers in
  // React's synthetic event system. The visual hint (drag-over ring)
  // reads from `dragOverIdx` so the user knows where the drop will land.
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const reorderGallery = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setGallery((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!nameAr.trim()) {
      setError("اسم المنتج بالعربية مطلوب");
      return;
    }
    if (!categoryId) {
      setError("الفئة مطلوبة");
      return;
    }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      setError("السعر مطلوب ويجب أن يكون رقماً موجباً");
      return;
    }
    if (parseInt(stockQty) < 0) {
      setError("الكمية في المخزون يجب أن تكون صفر أو أكثر");
      return;
    }
    if (!discountValid) {
      setError("سعر الخصم يجب أن يكون أقل من السعر الأصلي");
      return;
    }

    setSubmitting(true);
    const ok = await onSubmit({
      id: initial.id,
      name_ar: nameAr.trim(),
      name_en: nameEn.trim() || undefined,
      barcode: barcode.trim() || undefined,
      description: description.trim() || undefined,
      category_id: categoryId,
      price: parseFloat(price),
      discount_price: discountPrice ? parseFloat(discountPrice) : null,
      stock_qty: parseInt(stockQty) || 0,
      unit: unit || "حبة",
      image_url: imageUrl.trim() || null,
      images: gallery,
      is_featured: isFeatured,
      is_active: isActive,
    });
    setSubmitting(false);
    if (!ok) setError("فشل حفظ المنتج. تحقق من البيانات وحاول مرة أخرى.");
  };

  const hasLowStock = parseInt(stockQty) > 0 && parseInt(stockQty) <= 5;
  const hasNoStock = parseInt(stockQty) === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        العودة للمنتجات
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-secondary">
              {mode === "edit" ? "تعديل المنتج" : "إضافة منتج جديد"}
            </h1>
            <p className="text-sm text-gray-500">
              {mode === "edit"
                ? initial.name_ar
                : "أدخل تفاصيل المنتج ليظهر في المتجر"}
            </p>
          </div>
          {/* Active toggle */}
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              isActive
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-gray-100 text-gray-500 border border-gray-200"
            }`}
            aria-pressed={isActive}
          >
            {isActive ? (
              <>
                <Eye className="w-4 h-4" />
                مفعّل
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" />
                مخفي
              </>
            )}
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Section: Image & Gallery */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <ImageIcon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">الصور</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  الصورة الرئيسية
                </label>
                <ImageUploader
                  value={imageUrl}
                  onChange={setImageUrl}
                  folder="products"
                  placeholder="اضغط لرفع الصورة الرئيسية"
                  aspectRatio="aspect-square"
                />
                <p className="text-xs text-gray-400 mt-2">
                  تظهر في القوائم وبحث المتجر. يُفضّل 1:1 بأبعاد 800×800 على الأقل.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  معرض الصور (حتى 8 صور)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {gallery.map((url, idx) => (
                    <div
                      key={idx}
                      draggable
                      // HTML5 DnD — we keep state-local because React's
                      // synthetic events don't always carry dataTransfer
                      // values reliably, and we need a visual cue on the
                      // drop target.
                      onDragStart={(e) => {
                        setDraggingIdx(idx);
                        // required for Firefox to initiate drag
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverIdx !== idx) setDragOverIdx(idx);
                      }}
                      onDragLeave={() => {
                        if (dragOverIdx === idx) setDragOverIdx(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = draggingIdx;
                        setDraggingIdx(null);
                        setDragOverIdx(null);
                        if (from !== null) reorderGallery(from, idx);
                      }}
                      onDragEnd={() => {
                        setDraggingIdx(null);
                        setDragOverIdx(null);
                      }}
                      onClick={() => promoteGalleryImage(idx)}
                      className={`relative aspect-square bg-gray-50 rounded-lg overflow-hidden border group cursor-grab active:cursor-grabbing transition-all ${
                        draggingIdx === idx
                          ? "opacity-40 border-primary"
                          : dragOverIdx === idx
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-gray-200 hover:border-primary/50"
                      }`}
                      title="اسحب لإعادة الترتيب، أو اضغط لتكون الرئيسية"
                    >
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-cover pointer-events-none"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (!img.src.endsWith(PLACEHOLDER_SRC)) img.src = PLACEHOLDER_SRC;
                        }}
                      />
                      {idx === 0 && (
                        <span className="absolute top-1 right-1 text-[9px] bg-primary text-white px-1.5 py-0.5 rounded">
                          رئيسية
                        </span>
                      )}
                      {/* drag handle — visible on hover, signals the
                          tile is draggable so users discover the
                          affordance beyond the grab cursor. Bottom-
                          centered to keep the top-right reserved for
                          the "رئيسية" badge on the primary image. */}
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-black/40 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center gap-0.5">
                        <GripVertical className="w-3 h-3" />
                        <span className="text-[9px]">اسحب</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Prevent the parent click-to-promote from
                          // firing when the admin actually wants to
                          // delete a tile.
                          e.stopPropagation();
                          removeGalleryImage(idx);
                        }}
                        className="absolute top-1 left-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="حذف الصورة"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {gallery.length < 8 && (
                    <label
                      className={`flex flex-col items-center justify-center aspect-square bg-gray-50 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                        uploadingGallery
                          ? "border-primary/50 cursor-not-allowed"
                          : "border-gray-200 hover:border-primary/50 hover:bg-primary/5"
                      }`}
                    >
                      {uploadingGallery ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-gray-400" />
                          <span className="text-[10px] text-gray-400 mt-0.5">رفع</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        disabled={uploadingGallery}
                        onChange={(e) => handleGalleryUpload(e.target.files)}
                      />
                    </label>
                  )}
                </div>
                {galleryError && (
                  <p className="text-xs text-red-500 mt-2">{galleryError}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  اسحب الصور لإعادة ترتيبها، أو اضغط على صورة لتكون الرئيسية.
                </p>
              </div>
            </div>
          </section>

          {/* Section: Basic info */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">المعلومات الأساسية</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  اسم المنتج بالعربية <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: تفاح أحمر مستورد"
                  className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  اسم المنتج بالإنجليزية
                </label>
                <input
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  placeholder="Red Apple (Imported)"
                  dir="ltr"
                  className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-gray-400" />
                    الفئة <span className="text-red-500">*</span>
                  </span>
                </label>
                <SearchableSelect
                  value={categoryId}
                  onChange={setCategoryId}
                  options={categoryOptions.map((c) => ({ value: c.id, label: c.name_ar }))}
                  placeholder="— اختر الفئة —"
                  required
                  allowClear={false}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Barcode className="w-3.5 h-3.5 text-gray-400" />
                    الباركود
                  </span>
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="6281234567890"
                  dir="ltr"
                  className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
              </div>
            </div>
          </section>

          {/* Section: Pricing */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">التسعير</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  السعر <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-11 px-4 pl-10 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    ر.س
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  سعر الخصم
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountPrice}
                    onChange={(e) => setDiscountPrice(e.target.value)}
                    placeholder="اختياري"
                    className="w-full h-11 px-4 pl-10 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    ر.س
                  </span>
                </div>
                {!discountValid && (
                  <p className="text-xs text-red-500 mt-1">يجب أن يكون أقل من السعر</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  الوحدة
                </label>
                <SearchableSelect
                  value={unit}
                  onChange={setUnit}
                  options={UNIT_OPTIONS.map((u) => ({ value: u, label: u }))}
                  placeholder="— اختر الوحدة —"
                  includePlaceholderOption={false}
                  searchable={false}
                  allowClear={false}
                />
              </div>
            </div>
          </section>

          {/* Section: Inventory */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">المخزون</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  الكمية في المخزون <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  placeholder="0"
                  className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  سيتم الربط تلقائياً مع صفحة{" "}
                  <Link href="/admin/inventory" className="text-primary hover:underline">
                    تنبيهات المخزون
                  </Link>
                </p>
              </div>
              <div className="space-y-2">
                {hasNoStock && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>نفد المخزون — لن يظهر المنتج للزبائن</span>
                  </div>
                )}
                {hasLowStock && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>مخزون منخفض — سيظهر في تنبيهات لوحة التحكم</span>
                  </div>
                )}
                {!hasNoStock && !hasLowStock && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
                    <Info className="w-4 h-4 flex-shrink-0" />
                    <span>المخزون بحالة جيدة</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section: Description */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">الوصف</h2>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب وصفاً تفصيلياً للمنتج… يعرض في صفحة المنتج."
              rows={4}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </section>

          {/* Section: Visibility */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-secondary">الظهور</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-start gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="w-5 h-5 mt-0.5 rounded accent-primary"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800 block">منتج مميز</span>
                  <span className="text-xs text-gray-500">يظهر في قسم "المنتجات المميزة" بالصفحة الرئيسية</span>
                </div>
              </label>
              <label className="flex items-start gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-5 h-5 mt-0.5 rounded accent-primary"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800 block">منتج نشط</span>
                  <span className="text-xs text-gray-500">متاح للعرض والطلب في المتجر</span>
                </div>
              </label>
            </div>
          </section>

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
          {/*
            Storefront-equivalent preview. The ProductCard receives a
            synthesized Product so the editor sees exactly what shoppers
            will see once the record is saved — same price math, same
            discount badge, same rating display. The card is read-only here;
            clicking its image/title does nothing because the product id is
            empty until save.
          */}
          <PreviewButton
            formData={{
              nameAr,
              nameEn,
              imageUrl,
              price,
              discountPrice,
              isFeatured,
            }}
            previewTitle="معاينة بطاقة المنتج"
            previewDescription="هكذا سيظهر المنتج للمتسوق في قائمة المنتجات والصفحة الرئيسية."
            label="معاينة"
            disabled={submitting}
            buttonClassName="px-6 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-white transition-colors flex items-center gap-2"
            renderPreview={(d) => {
              const numericPrice = parseFloat(d.price) || 0;
              const numericDiscount = d.discountPrice
                ? parseFloat(d.discountPrice)
                : null;
              const previewProduct = {
                id: "preview",
                category_id: "",
                name_ar: d.nameAr || "اسم المنتج",
                name_en: d.nameEn || null,
                barcode: null,
                description: null,
                image_url: d.imageUrl || null,
                images: [],
                price: numericPrice,
                discount_price:
                  numericDiscount && numericDiscount < numericPrice
                    ? numericDiscount
                    : null,
                stock_qty: 0,
                unit: unit || "حبة",
                is_featured: d.isFeatured,
                is_active: true,
                category_name:
                  categoryOptions.find((c) => c.id === categoryId)?.name_ar ||
                  "",
                avg_rating: 0,
                reviews_count: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              return (
                <div className="bg-gray-50 p-6 rounded-xl">
                  <p className="text-xs text-gray-500 mb-3">
                    المعاينة لا تُحفظ — اضغط "حفظ" لتأكيد التغييرات.
                  </p>
                  <div className="max-w-xs mx-auto">
                    <ProductCard
                      product={previewProduct as any}
                    />
                  </div>
                </div>
              );
            }}
          />
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
                {mode === "edit" ? "حفظ التعديلات" : "إنشاء المنتج"}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
