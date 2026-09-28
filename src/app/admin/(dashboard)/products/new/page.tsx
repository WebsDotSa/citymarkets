"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ProductEditForm,
  type ProductFormValues,
} from "@/components/admin/product-edit-form";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";

const empty: ProductFormValues = {
  name_ar: "",
  name_en: "",
  barcode: "",
  description: "",
  category_id: "",
  price: "",
  discount_price: "",
  stock_qty: 0,
  unit: "حبة",
  image_url: "",
  images: [],
  is_featured: false,
  is_active: true,
};

export default function NewProductPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [categories, setCategories] = useState<
    { id: string; name_ar: string }[]
  >([]);
  const { showToast } = useToast();

  // Same return-state forwarding as the edit page: the "+" link on the
  // products list passes the current page / filters so creating a product
  // lands the operator back where they started.
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
        const res = await fetch("/api/admin/categories", {
          credentials: "include",
          signal: ac.signal,
        });
        const json = await res.json();
        if (ac.signal.aborted) return;
        const list = json.success ? json.data : [];
        setCategories(
          list
            .filter((c: { is_active?: boolean }) => c.is_active !== false)
            .map((c: { id: string; name_ar: string }) => ({
              id: String(c.id),
              name_ar: c.name_ar,
            }))
        );
      } catch (e) {
        if (!ac.signal.aborted) console.error(e);
      }
    })();
    return () => ac.abort();
  }, []);

  const handleSubmit = async (data: ProductFormValues): Promise<boolean> => {
    try {
      const res = await csrfFetch("/api/admin/products", {
        method: "POST",
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
              message: "تم إنشاء المنتج بنجاح",
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
      showToast("فشل إنشاء المنتج", "error");
    }
    return false;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <ProductEditForm
        mode="create"
        initial={empty}
        categoryOptions={categories}
        backHref={backHref}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
