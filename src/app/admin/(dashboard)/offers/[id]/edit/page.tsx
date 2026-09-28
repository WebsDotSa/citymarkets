"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import {
  OfferEditForm,
  type OfferFormValues,
} from "@/components/admin/offer-edit-form";
import type { AdminOffer } from "@/lib/admin-types";

const adminCred = { credentials: "include" as const };

export default function EditOfferPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [initial, setInitial] = useState<OfferFormValues | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/admin/offers/${encodeURIComponent(id)}`, {
          ...adminCred,
          signal: ac.signal,
        });
        const json = await res.json();
        if (ac.signal.aborted) return;

        if (!res.ok || !json.success) {
          showToast(json.error || "تعذر تحميل العرض", "error");
          setLoading(false);
          return;
        }

        const o: AdminOffer = json.data;
        setInitial({
          id: o.id,
          title_ar: o.title_ar || "",
          title_en: o.title_en || "",
          description_ar: o.description_ar || "",
          description_en: o.description_en || "",
          image_url: o.image_url || "",
          discount_type: o.discount_type,
          discount_value: o.discount_value ?? "",
          max_discount: o.max_discount ?? "",
          min_order: o.min_order ?? "",
          starts_at: o.starts_at,
          ends_at: o.ends_at,
          is_active: o.is_active !== false,
          is_featured: !!o.is_featured,
          sort_order: o.sort_order ?? 0,
          applies_to: o.applies_to || "mixed",
          targets: o.targets || [],
        });
      } catch (e) {
        if (!ac.signal.aborted) console.error(e);
      }
      if (!ac.signal.aborted) setLoading(false);
    })();
    return () => ac.abort();
  }, [id, showToast]);

  const handleSubmit = async (
    data: OfferFormValues,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await csrfFetch(`/api/admin/offers/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json();
      if (json.success) {
        showToast("تم تحديث العرض", "success");
        router.push("/admin/offers");
        return { ok: true };
      }
      const msg = json.error || "فشل تحديث العرض";
      showToast(msg, "error");
      return { ok: false, error: msg };
    } catch {
      const msg = "حدث خطأ في الشبكة";
      showToast(msg, "error");
      return { ok: false, error: msg };
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>العرض غير موجود</p>
        <button
          type="button"
          onClick={() => router.push("/admin/offers")}
          className="mt-4 text-primary text-sm font-medium"
        >
          العودة للعروض
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <OfferEditForm mode="edit" initial={initial} onSubmit={handleSubmit} />
    </div>
  );
}
