"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ProductEditForm,
  type ProductFormValues,
} from "@/components/admin/product-edit-form";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import type { AdminProduct } from "@/lib/admin-types";

type ProductRow = AdminProduct;

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [initial, setInitial] = useState<ProductFormValues | null>(null);
  const [categories, setCategories] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  // Build the URL to return to after save / cancel. The products list page
  // forwards its current page + filters as `?page=&category_id=&is_active=
  // &search=&limit=` so the operator comes back to the same row position
  // instead of being dropped on page 1 with no filters.
  const backHref = useMemo(() => {
    const sp = new URLSearchParams();
    const rp = searchParams.get("page");
    const rc = searchParams.get("category_id");
    const rs = searchParams.get("is_active");
    const rsr = searchParams.get("search");
    const rl = searchParams.get("limit");
    if (rp) sp.set("page", rp);
    if (rc) sp.set("category_id", rc);
    if (rs === "true" || rs === "false") sp.set("is_active", rs);
    if (rsr) sp.set("search", rsr);
    if (rl) sp.set("limit", rl);
    const qs = sp.toString();
    return qs ? `/admin/products?${qs}` : "/admin/products";
  }, [searchParams]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [prodRes, catRes] = await Promise.all([
          fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
            credentials: "include",
            signal: ac.signal,
          }),
          fetch("/api/admin/categories", {
            credentials: "include",
            signal: ac.signal,
          }),
        ]);
        const prodJson = await prodRes.json();
        const catJson = await catRes.json();
        if (ac.signal.aborted) return;

        const catList: { id: string; name_ar: string }[] = catJson.success
          ? catJson.data.map((c: { id: string; name_ar: string }) => ({
              id: String(c.id),
              name_ar: c.name_ar,
            }))
          : [];

        setCategories(catList);

        if (!prodRes.ok || !prodJson.success) {
          showToast(prodJson.error || "تعذر تحميل المنتج", "error");
          setLoading(false);
          return;
        }

        const prod: ProductRow = prodJson.data;
        setInitial({
          id: prod.id,
          name_ar: prod.name_ar || "",
          name_en: prod.name_en || "",
          barcode: prod.barcode || "",
          description: prod.description || "",
          category_id: String(prod.category_id || ""),
          price: prod.price,
          discount_price: prod.discount_price,
          stock_qty: prod.stock_qty,
          unit: prod.unit || "حبة",
          image_url: prod.image_url || "",
          images: Array.isArray(prod.images) ? prod.images : [],
          is_featured: !!prod.is_featured,
          is_active: prod.is_active !== false,
        });
      } catch (e) {
        if (!ac.signal.aborted) console.error(e);
      }
      if (!ac.signal.aborted) setLoading(false);
    })();
    return () => ac.abort();
  }, [id, showToast]);

  const handleSubmit = async (data: ProductFormValues): Promise<boolean> => {
    try {
      const res = await csrfFetch(`/api/admin/products?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const result = await res.json();
      if (result.success) {
        // Stash the success toast in sessionStorage so it survives the
        // hard reload below — the products list page picks it up on
        // mount, shows it, then clears the slot.
        try {
          sessionStorage.setItem(
            "admin:products:post-save-toast",
            JSON.stringify({
              kind: "success",
              message: "تم تحديث المنتج بنجاح",
              at: Date.now(),
            }),
          );
        } catch {
          // sessionStorage can be unavailable (Safari private mode, etc.);
          // safe to ignore — the toast just won't show after the reload.
        }
        // Hard navigation forces a full page reload — the products list
        // container is rebuilt from scratch on the new page, with the
        // URL params (page / category_id / is_active / search / limit)
        // restored by the URL→state effect. No residual React state,
        // scroll position, focus, or stale fetch responses can survive.
        window.location.assign(backHref);
        return true;
      }
      if (result.error) showToast(result.error, "error");
      else showToast("فشل حفظ المنتج. تحقق من البيانات وحاول مرة أخرى.", "error");
    } catch (e) {
      console.error(e);
      showToast("فشل تحديث المنتج", "error");
    }
    return false;
  };

  return (
    <div className="max-w-4xl mx-auto">
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : !initial ? (
        <div className="text-center py-20 text-gray-500">
          <p>المنتج غير موجود</p>
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="mt-4 text-primary text-sm font-medium"
          >
            العودة للمنتجات
          </button>
        </div>
      ) : (
        <ProductEditForm
          mode="edit"
          initial={initial}
          categoryOptions={categories}
          backHref={backHref}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
