"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CategoryEditForm,
  type CategoryFormValues,
} from "@/components/admin/category-edit-form";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";

const empty: CategoryFormValues = {
  name_ar: "",
  name_en: "",
  slug: "",
  icon_url: "",
  sort_order: 0,
  parent_id: null,
  is_active: true,
  description_ar: "",
  description_en: "",
};

export default function NewCategoryPage() {
  const router = useRouter();
  const [parentOptions, setParentOptions] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/categories", {
          credentials: "include",
          signal: ac.signal,
        });
        const json = await res.json();
        if (ac.signal.aborted) return;
        const list = json.success ? json.data : [];
        setParentOptions(
          list
            .filter((c: { parent_id: string | null }) => !c.parent_id)
            .map((c: { id: string; name_ar: string }) => ({
              id: c.id,
              name_ar: c.name_ar,
            }))
        );
      } catch (e) {
        if (!ac.signal.aborted) console.error(e);
      }
    })();
    return () => ac.abort();
  }, []);

  const handleSubmit = async (data: CategoryFormValues): Promise<boolean> => {
    try {
      const res = await csrfFetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const result = await res.json();
      if (result.success) {
        showToast("تم إنشاء الفئة بنجاح", "success");
        router.push("/admin/categories");
        return true;
      }
      if (result.error) showToast(result.error, "error");
    } catch (e) {
      console.error(e);
      showToast("فشل إنشاء الفئة", "error");
    }
    return false;
  };

  return (
    <div className="max-w-3xl mx-auto">
        <CategoryEditForm
          mode="create"
          initial={empty}
          parentOptions={parentOptions}
          onSubmit={handleSubmit}
        />
      </div>
  );
}