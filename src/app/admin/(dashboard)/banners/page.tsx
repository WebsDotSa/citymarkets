"use client";

import { useState, useEffect } from "react";
import { DataTable } from "@/components/admin/data-table";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { useToast, useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from "@/lib/api";
import Image from "next/image";
import type { Banner } from "@/lib/types";
import { ArrowUp, Save, Plus } from "lucide-react";

const adminCred = { credentials: "include" as const };

type View = "list" | "form";

export default function AdminBannersPage() {
  const [view, setView] = useState<View>("list");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [editingItem, setEditingItem] = useState<Banner | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  // Form state
  const [imageUrl, setImageUrl] = useState("");
  const [linkType, setLinkType] = useState("none");
  const [linkValue, setLinkValue] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, []);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch<Banner[]>("/api/admin/banners", { signal });
      if (signal?.aborted) return;
      if (res.success) setBanners(res.data);
    } catch (error) {
      if (!signal?.aborted) {
        console.error(error);
        showToast("فشل تحميل البانرات", "error");
      }
    }
    if (!signal?.aborted) setLoading(false);
  };

  const resetForm = () => {
    setImageUrl("");
    setLinkType("none");
    setLinkValue("");
    setSortOrder(0);
    setActive(true);
    setEditingItem(null);
  };

  const handleAdd = () => {
    resetForm();
    setView("form");
  };

  const handleEdit = (item: Banner) => {
    setEditingItem(item);
    setImageUrl(item.image_url || "");
    setLinkType(item.link_type || "none");
    setLinkValue(item.link_value || "");
    // Banner.sort_order is typed as number; legacy DB rows may surface it
    // as a string, so coerce before assigning to the number-typed field.
    setSortOrder(Number(item.sort_order) || 0);
    setActive(item.is_active !== false && item.active !== false);
    setView("form");
  };

  const handleDelete = async (item: Banner) => {
    if (!(await confirm({ title: "حذف بانر", message: "هل أنت متأكد من حذف هذا البانر؟", danger: true }))) return;
    try {
      // Delete image file if local
      if (item.image_url?.startsWith("/images/")) {
        await csrfFetch(`/api/admin/upload?path=${encodeURIComponent(item.image_url)}`, {
          method: "DELETE",
          ...adminCred,
        });
      }
      const res = await csrfFetch(`/api/admin/banners?id=${item.id}`, { method: "DELETE", ...adminCred }).then((r) => r.json());
      if (res?.success) {
        showToast("تم حذف البانر", "success");
        loadData();
      } else {
        showToast(res?.error || "فشل حذف البانر", "error");
      }
    } catch (error) { showToast("فشل في حذف البانر", "error"); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) { showToast("يرجى رفع صورة أو إدخال رابط", "warning"); return; }

    setSubmitting(true);
    try {
      const data = {
        image_url: imageUrl,
        link_type: linkType,
        link_value: linkValue || null,
        active,
        sort_order: sortOrder,
      };

      const method = editingItem ? "PUT" : "POST";
      const url = editingItem
        ? `/api/admin/banners?id=${editingItem.id}`
        : "/api/admin/banners";

      const res = await csrfFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        ...adminCred,
      });

      const result = await res.json();
      if (result.success) {
        loadData();
        setView("list");
        resetForm();
        showToast("تم حفظ البانر", "success");
      } else {
        showToast("فشل في حفظ البانر", "error");
      }
    } catch (error) {
      showToast("حدث خطأ", "error");
    }
    setSubmitting(false);
  };

  const columns = [
    {
      key: "image_url",
      label: "الصورة",
      render: (row: Banner) =>
        row.image_url ? (
          <div className="relative w-24 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
            <Image src={row.image_url} alt="" fill className="object-cover" />
          </div>
        ) : "—",
    },
    {
      key: "link_type",
      label: "نوع الرابط",
      render: (row: Banner) => {
        const labels: Record<string, string> = { product: "منتج", category: "فئة", external: "خارجي", none: "بدون" };
        return labels[row.link_type] || row.link_type;
      },
    },
    { key: "link_value", label: "قيمة الرابط" },
    { key: "sort_order", label: "الترتيب" },
    {
      key: "active",
      label: "الحالة",
      render: (row: Banner) =>
        row.active ? (
          <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">نشط</span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700">غير نشط</span>
        ),
    },
  ];

  if (view === "form") {
    return (
      <div className="max-w-3xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => { setView("list"); resetForm(); }}
            className="flex items-center gap-2 text-sm text-gray-500 mb-6 hover:text-primary transition-colors"
          >
            <ArrowUp className="w-4 h-4 rotate-90" />
            <span>العودة للبنرات</span>
          </button>

          {/* Form card */}
          <form onSubmit={handleSubmit}>
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              {/* Header */}
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                    <span className="text-white text-xl">🖼</span>
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-secondary">
                      {editingItem ? "تعديل البانر" : "إضافة بانر جديد"}
                    </h1>
                    <p className="text-sm text-gray-500">
                      {editingItem ? `بانر رقم ${editingItem.sort_order}` : "أضف بانر إعلاني للصفحة الرئيسية"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* Image upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    صورة البانر <span className="text-red-500">*</span>
                  </label>
                  <ImageUploader
                    value={imageUrl}
                    onChange={setImageUrl}
                    folder="banners"
                    placeholder="اضغط لرفع صورة البانر"
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    الحجم المثالي: 800×300 بكسل • يُفضّل WEBP أو JPG
                  </p>
                </div>

                {/* Link type & value */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      نوع الرابط
                    </label>
                    <SearchableSelect
                      value={linkType}
                      onChange={setLinkType}
                      options={[
                        { value: "none", label: "بدون رابط" },
                        { value: "category", label: "فئة" },
                        { value: "product", label: "منتج" },
                        { value: "external", label: "رابط خارجي" },
                      ]}
                      includePlaceholderOption={false}
                      searchable={false}
                      allowClear={false}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      قيمة الرابط
                    </label>
                    <input
                      type="text"
                      value={linkValue}
                      onChange={(e) => setLinkValue(e.target.value)}
                      placeholder={
                        linkType === "category" ? "مثال: fruits-vegetables" :
                        linkType === "product" ? "معرف المنتج" :
                        linkType === "external" ? "https://..." :
                        "—"
                      }
                      disabled={linkType === "none"}
                      className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                </div>

                {/* Sort order & Active */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      ترتيب العرض
                    </label>
                    <input
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                      className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    <p className="text-xs text-gray-400 mt-1">الرقم الأقل يظهر أولاً</p>
                  </div>
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer py-2">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => setActive(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 rounded-full peer-checked:bg-primary transition-colors"></div>
                        <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform"></div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-secondary">نشط</p>
                        <p className="text-xs text-gray-400">عرض البانر في الموقع</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setView("list"); resetForm(); }}
                  className="px-6 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting || !imageUrl}
                  className="px-6 py-2.5 bg-gradient-to-r from-primary to-primary-dark text-white text-sm font-medium rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>{editingItem ? "تحديث" : "حفظ"}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={banners}
        title="إدارة البانرات"
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        loading={loading}
      />
      {confirm.dialog}
    </>
  );
}
