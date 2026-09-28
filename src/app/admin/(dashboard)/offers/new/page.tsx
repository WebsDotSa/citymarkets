"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import {
  OfferEditForm,
  type OfferFormValues,
} from "@/components/admin/offer-edit-form";

const empty: OfferFormValues = {
  title_ar: "",
  title_en: "",
  description_ar: "",
  description_en: "",
  image_url: "",
  discount_type: "percentage",
  discount_value: "",
  max_discount: "",
  min_order: "",
  // Default to "now" and +7 days so the offer is immediately valid.
  starts_at: new Date().toISOString(),
  ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  is_active: true,
  is_featured: false,
  sort_order: 0,
  applies_to: "mixed",
  targets: [],
};

export default function NewOfferPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const handleSubmit = async (
    data: OfferFormValues,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await csrfFetch("/api/admin/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json();
      if (json.success) {
        showToast("تم إنشاء العرض", "success");
        router.push("/admin/offers");
        return { ok: true };
      }
      const msg = json.error || "فشل إنشاء العرض";
      showToast(msg, "error");
      return { ok: false, error: msg };
    } catch (e) {
      const msg = "حدث خطأ في الشبكة";
      showToast(msg, "error");
      return { ok: false, error: msg };
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <OfferEditForm mode="create" initial={empty} onSubmit={handleSubmit} />
    </div>
  );
}
