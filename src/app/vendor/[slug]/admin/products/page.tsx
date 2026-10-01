"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { useFormFieldIdFromLabel } from "@/hooks/use-form-field-id";
import { useVendorRole } from "../_lib/vendor-role-context";

interface ProductsPageProps {
  params: Promise<{ slug: string }>;
}

interface Product {
  id: string;
  name: string;
  nameEn?: string;
  images: string[];
  price: number;
  discountPrice?: number;
  stock?: number;
  trackStock: boolean;
  isActive: boolean;
  sku?: string;
  createdAt: string;
}

export default function VendorProductsPage({ params }: ProductsPageProps) {
  const { slug } = use(params);
  const { canDo, isReadOnly } = useVendorRole();
  const canManage = canDo("manage_products");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    fetchProducts();
  }, [slug, page, search]);

  async function fetchProducts() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/v1/vendor/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error("Fetch products error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(product: Product) {
    try {
      const res = await csrfFetch(`/api/v1/vendor/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (res.ok) {
        setProducts(products.map((p) =>
          p.id === product.id ? { ...p, isActive: !p.isActive } : p
        ));
      }
    } catch (error) {
      console.error("Toggle active error:", error);
    }
  }

  async function deleteProduct(product: Product) {
    if (!(await confirm({ title: "حذف منتج", message: `هل أنت متأكد من حذف "${product.name}"؟`, danger: true }))) return;
    try {
      const res = await csrfFetch(`/api/v1/vendor/products/${product.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProducts(products.filter((p) => p.id !== product.id));
      }
    } catch (error) {
      console.error("Delete product error:", error);
    }
  }

  return (
    <div className="space-y-6">
      {isReadOnly && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          وضع القراءة فقط — هذه الصلاحية لا تسمح بإضافة أو تعديل المنتجات.
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المنتجات</h1>
          <p className="text-gray-500">إدارة منتجات متجرك</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={!canManage}
          title={canManage ? "إضافة منتج جديد" : "ليس لديك صلاحية لإضافة منتجات"}
          className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + إضافة منتج جديد
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-2xl p-4">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="ابحث عن منتج..."
          className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
        />
      </div>

      {/* Products list */}
      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-xl animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="divide-y">
            {products.map((product) => (
              <div key={product.id} className="p-4 flex items-center gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
                  {product.images[0] ? (
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">
                      📦
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate">{product.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-primary font-bold">
                      {product.discountPrice ? product.discountPrice : product.price} ر.س
                    </span>
                    {product.discountPrice && (
                      <span className="text-xs text-gray-400 line-through">
                        {product.price}
                      </span>
                    )}
                  </div>
                  {product.trackStock && (
                    <p className={`text-xs mt-1 ${(product.stock || 0) <= 5 ? "text-red-500" : "text-gray-500"}`}>
                      المخزون: {product.stock || 0}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(product)}
                    disabled={!canManage}
                    title={canManage ? "تبديل حالة النشاط" : "ليس لديك صلاحية"}
                    className={`px-3 py-1 rounded-full text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                      product.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {product.isActive ? "نشط" : "غير نشط"}
                  </button>
                  <Link
                    href={`/vendors/${slug}/products/${product.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
                  >
                    👁️
                  </Link>
                  {canDo("manage_categories") && (
                    <button
                      onClick={() => deleteProduct(product)}
                      title="حذف المنتج"
                      className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500">لا توجد منتجات</p>
            {canManage && (
              <button
                onClick={() => setShowModal(true)}
                className="mt-2 text-primary hover:underline"
              >
                أضف منتجك الأول
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
          >
            السابق
          </button>
          <span className="px-4 py-2">
            {page} من {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      )}

      {/* Add Product Modal — hidden from roles without write access
          so a viewer/staff cannot open it and submit a 403. */}
      {showModal && canManage && (
        <AddProductModal
          slug={slug}
          onClose={() => setShowModal(false)}
          onSuccess={(product) => {
            setProducts([product, ...products]);
            setShowModal(false);
          }}
        />
      )}
      {confirm.dialog}
    </div>
  );
}

function AddProductModal({
  slug,
  onClose,
  onSuccess,
}: {
  slug: string;
  onClose: () => void;
  onSuccess: (product: any) => void;
}) {
  // Stable ids for label/input pairs in this form so screen readers
  // announce the field name when each input is focused.
  const nameId = useFormFieldIdFromLabel("vendor-product-modal", "اسم المنتج *");
  const priceId = useFormFieldIdFromLabel("vendor-product-modal", "السعر (ر.س) *");
  const descId = useFormFieldIdFromLabel("vendor-product-modal", "الوصف");
  const categoryId = useFormFieldIdFromLabel("vendor-product-modal", "القسم");
  const stockId = useFormFieldIdFromLabel("vendor-product-modal", "الكمية");

  const [formData, setFormData] = useState({
    nameAr: "",
    price: "",
    descriptionAr: "",
    stockQuantity: "",
    trackStock: false,
    isActive: true,
    categoryId: "",
  });
  const [globalCategories, setGlobalCategories] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const [privateCategories, setPrivateCategories] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/vendor/categories", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const payload = data.data ?? {};
        setGlobalCategories(
          Array.isArray(payload.global)
            ? payload.global.map((c: any) => ({
                id: c.id,
                name_ar: c.name_ar,
              }))
            : [],
        );
        setPrivateCategories(
          Array.isArray(payload.private)
            ? payload.private.map((c: any) => ({
                id: c.id,
                name_ar: c.name_ar,
              }))
            : [],
        );
      } catch {
        /* ignore — categories are optional */
      } finally {
        if (!cancelled) setLoadingCats(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await csrfFetch("/api/v1/vendor/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameAr: formData.nameAr,
          price: parseFloat(formData.price),
          descriptionAr: formData.descriptionAr,
          stockQuantity: parseInt(formData.stockQuantity) || 0,
          trackStock: formData.trackStock,
          isActive: formData.isActive,
          categoryId: formData.categoryId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "فشل في إنشاء المنتج");
        return;
      }

      onSuccess(data.product);
    } catch {
      setError("حدث خطأ، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">إضافة منتج جديد</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor={nameId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              اسم المنتج *
            </label>
            <input
              id={nameId}
              type="text"
              value={formData.nameAr}
              onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor={priceId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              السعر (ر.س) *
            </label>
            <input
              id={priceId}
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor={descId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              الوصف
            </label>
            <textarea
              id={descId}
              value={formData.descriptionAr}
              onChange={(e) => setFormData({ ...formData, descriptionAr: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              rows={3}
            />
          </div>

          <div>
            <label
              htmlFor={categoryId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              القسم
            </label>
            <select
              id={categoryId}
              value={formData.categoryId}
              onChange={(e) =>
                setFormData({ ...formData, categoryId: e.target.value })
              }
              disabled={loadingCats}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none bg-white"
            >
              <option value="">بدون تصنيف</option>
              {globalCategories.length > 0 && (
                <optgroup label="عام">
                  {globalCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_ar}
                    </option>
                  ))}
                </optgroup>
              )}
              {privateCategories.length > 0 && (
                <optgroup label="خاص بمتجري">
                  {privateCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_ar}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              الأقسام العامة تظهر لجميع المتاجر، والخاصة تظهر لمتجرك فقط.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.trackStock}
                onChange={(e) => setFormData({ ...formData, trackStock: e.target.checked })}
                className="w-4 h-4"
                aria-label="تتبع المخزون"
              />
              <span className="text-sm">تتبع المخزون</span>
            </label>
          </div>

          {formData.trackStock && (
            <div>
              <label
                htmlFor={stockId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                الكمية
              </label>
              <input
                id={stockId}
                type="number"
                value={formData.stockQuantity}
                onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4"
                aria-label="نشط"
              />
              <span className="text-sm">نشط</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border hover:bg-gray-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "جاري الحفظ..." : "حفظ"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
