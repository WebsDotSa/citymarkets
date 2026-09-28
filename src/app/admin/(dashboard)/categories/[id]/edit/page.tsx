"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CategoryEditForm,
  type CategoryFormValues,
} from "@/components/admin/category-edit-form";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import type { AdminCategory } from "@/lib/admin-types";

type CategoryRow = AdminCategory;

export default function EditCategoryPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [initial, setInitial] = useState<CategoryFormValues | null>(null);
  const [parentOptions, setParentOptions] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [catRes, parentsRes] = await Promise.all([
          fetch(`/api/admin/categories/${encodeURIComponent(id)}`, {
            credentials: "include",
            signal: ac.signal,
          }),
          fetch("/api/admin/categories", {
            credentials: "include",
            signal: ac.signal,
          }),
        ]);
        const catJson = await catRes.json();
        const parentsJson = await parentsRes.json();
        if (ac.signal.aborted) return;

        if (!catRes.ok || !catJson.success) {
          showToast(catJson.error || "تعذر تحميل الفئة", "error");
          setLoading(false);
          return;
        }

        const cat: CategoryRow = catJson.data;
        setInitial({
          id: cat.id,
          name_ar: cat.name_ar || "",
          name_en: cat.name_en || "",
          slug: cat.slug || "",
          icon_url: cat.icon_url || "",
          sort_order: cat.sort_order ?? 0,
          parent_id: cat.parent_id || null,
          is_active: cat.is_active !== false,
          description_ar: cat.description_ar || "",
          description_en: cat.description_en || "",
          parent_name_ar: cat.parent_name_ar || null,
        });

        const parentList: CategoryRow[] = parentsJson.success
          ? parentsJson.data
          : [];
        setParentOptions(
          parentList
            .filter((c) => !c.parent_id && c.id !== id)
            .map((c) => ({ id: c.id, name_ar: c.name_ar }))
        );
      } catch (e) {
        if (!ac.signal.aborted) console.error(e);
      }
      if (!ac.signal.aborted) setLoading(false);
    })();
    return () => ac.abort();
  }, [id, showToast]);

  const handleSubmit = async (data: CategoryFormValues): Promise<boolean> => {
    try {
      const res = await csrfFetch(`/api/admin/categories?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const result = await res.json();
      if (result.success) {
        showToast("تم تحديث الفئة بنجاح", "success");
        router.push("/admin/categories");
        return true;
      }
      if (result.error) showToast(result.error, "error");
    } catch (e) {
      console.error(e);
      showToast("فشل تحديث الفئة", "error");
    }
    return false;
  };

  return (
    <div className="max-w-3xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : !initial ? (
          <div className="text-center py-20 text-gray-500">
            <p>الفئة غير موجودة</p>
            <button
              type="button"
              onClick={() => router.push("/admin/categories")}
              className="mt-4 text-primary text-sm font-medium"
            >
              العودة للفئات
            </button>
          </div>
        ) : (
          <CategoryEditForm
            mode="edit"
            initial={initial}
            parentOptions={parentOptions}
            onSubmit={handleSubmit}
          />
        )}
      </div>
  );
}