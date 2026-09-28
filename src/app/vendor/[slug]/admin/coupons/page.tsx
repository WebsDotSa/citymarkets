"use client";

import { useEffect, useState, use } from "react";
import { useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { Tag, Plus, Loader2, Copy, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";

interface CouponsPageProps {
  params: Promise<{ slug: string }>;
}

interface Coupon {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minOrder: number | null;
  maxUses: number | null;
  currentUses: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; coupon: Coupon };

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm";

export default function VendorCouponsPage({ params }: CouponsPageProps) {
  use(params); // satisfies the param typing for the layout
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/vendor/coupons", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCoupons(data.coupons || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(c: Coupon) {
    const res = await csrfFetch(`/api/v1/vendor/coupons/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !c.isActive }),
      credentials: "include",
    }).then((r) => r.json());
    if (res.success) {
      setCoupons((cs) =>
        cs.map((x) => (x.id === c.id ? { ...x, isActive: !x.isActive } : x)),
      );
    }
  }

  async function deleteCoupon(c: Coupon) {
    if (
      !(await confirm({
        title: "حذف الكوبون",
        message: `حذف الكوبون "${c.code}"؟ هذا الإجراء لا يمكن التراجع عنه.`,
        danger: true,
      }))
    )
      return;
    const res = await csrfFetch(`/api/v1/vendor/coupons/${c.id}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.json());
    if (res.success) {
      setCoupons((cs) => cs.filter((x) => x.id !== c.id));
    }
  }

  function copy(code: string, id: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الكوبونات</h1>
          <p className="text-gray-500">إدارة كوبونات الخصم لمتجرك</p>
        </div>
        <button
          onClick={() => setModal({ kind: "create" })}
          className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          إنشاء كوبون جديد
        </button>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : coupons.length === 0 ? (
          <div className="p-12 text-center">
            <Tag className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 mb-1">لا توجد كوبونات حتى الآن</p>
            <p className="text-sm text-gray-400">
              أنشئ كوبوناً لتشجيع العملاء على الطلب
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {coupons.map((c) => (
              <div key={c.id} className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Tag className="w-6 h-6 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copy(c.code, c.id)}
                      className="font-mono font-bold text-lg text-primary hover:bg-primary/5 px-2 py-0.5 rounded-md transition flex items-center gap-1.5"
                      title="نسخ الكود"
                    >
                      {c.code}
                      <Copy className="w-3.5 h-3.5 opacity-60" />
                    </button>
                    {copiedId === c.id && (
                      <span className="text-xs text-emerald-600">✓ تم النسخ</span>
                    )}
                    {!c.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">
                        معطل
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    خصم{" "}
                    {c.discountType === "percent"
                      ? `${c.discountValue}%`
                      : `${c.discountValue} ر.س`}
                    {c.minOrder && (
                      <span className="text-gray-400">
                        {" "}
                        • على طلبات ≥ {c.minOrder} ر.س
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    استخدم {c.currentUses}
                    {c.maxUses ? ` / ${c.maxUses}` : ""} مرة
                    {c.validUntil && (
                      <span>
                        {" "}
                        • ينتهي{" "}
                        {new Date(c.validUntil).toLocaleDateString("ar-SA")}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleActive(c)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition"
                    title={c.isActive ? "إيقاف" : "تفعيل"}
                  >
                    {c.isActive ? (
                      <ToggleRight className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={() => setModal({ kind: "edit", coupon: c })}
                    className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-600"
                    title="تعديل"
                  >
                    تعديل
                  </button>
                  <button
                    onClick={() => deleteCoupon(c)}
                    className="p-2 rounded-lg hover:bg-red-50 transition text-red-600"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal.kind !== "closed" && (
        <CouponModal
          state={modal}
          submitting={submitting}
          onClose={() => setModal({ kind: "closed" })}
          onSaved={async () => {
            setModal({ kind: "closed" });
            await load();
          }}
          onSubmittingChange={setSubmitting}
        />
      )}

      {confirm.dialog}
    </div>
  );
}

function CouponModal({
  state,
  submitting,
  onClose,
  onSaved,
  onSubmittingChange,
}: {
  state: { kind: "create" } | { kind: "edit"; coupon: Coupon };
  submitting: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onSubmittingChange: (v: boolean) => void;
}) {
  const editing = state.kind === "edit";
  const initial: any = editing
    ? state.coupon
    : {
        code: "",
        discountType: "percent",
        discountValue: 10,
        minOrder: null,
        maxUses: null,
        validFrom: null,
        validUntil: null,
        isActive: true,
      };

  const [form, setForm] = useState<any>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initial);
    setError(null);
  }, [state.kind, (state as any).coupon?.id]);

  function update<K extends string>(key: K, value: any) {
    setForm((f: any) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onSubmittingChange(true);
    try {
      const payload = {
        code: form.code?.trim() || undefined,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        minOrder: form.minOrder ? Number(form.minOrder) : null,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
        isActive: form.isActive !== false,
      };
      const url = editing
        ? `/api/v1/vendor/coupons/${state.coupon.id}`
        : "/api/v1/vendor/coupons";
      const method = editing ? "PATCH" : "POST";
      const res = await csrfFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      }).then((r) => r.json());
      if (!res.success) {
        setError(res.error || "فشل الحفظ");
        return;
      }
      await onSaved();
    } catch {
      setError("حدث خطأ في الاتصال");
    } finally {
      onSubmittingChange(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b">
            <h2 className="text-xl font-bold text-gray-900">
              {editing ? "تعديل الكوبون" : "كوبون جديد"}
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                كود الكوبون
              </label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => update("code", e.target.value.toUpperCase())}
                placeholder="اتركه فارغاً لتوليد تلقائي"
                className={`${inputClass} font-mono`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  نوع الخصم
                </label>
                <select
                  value={form.discountType}
                  onChange={(e) => update("discountType", e.target.value)}
                  className={inputClass}
                >
                  <option value="percent">نسبة مئوية %</option>
                  <option value="fixed">مبلغ ثابت (ر.س)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  القيمة
                </label>
                <input
                  type="number"
                  value={form.discountValue}
                  onChange={(e) => update("discountValue", e.target.value)}
                  min={1}
                  max={form.discountType === "percent" ? 100 : undefined}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  حد أدنى للطلب
                </label>
                <input
                  type="number"
                  value={form.minOrder ?? ""}
                  onChange={(e) =>
                    update("minOrder", e.target.value || null)
                  }
                  min={0}
                  placeholder="اختياري"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  عدد الاستخدامات
                </label>
                <input
                  type="number"
                  value={form.maxUses ?? ""}
                  onChange={(e) =>
                    update("maxUses", e.target.value || null)
                  }
                  min={1}
                  placeholder="بلا حدود"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  صالح من
                </label>
                <input
                  type="date"
                  value={form.validFrom?.slice(0, 10) ?? ""}
                  onChange={(e) => update("validFrom", e.target.value || null)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ينتهي في
                </label>
                <input
                  type="date"
                  value={form.validUntil?.slice(0, 10) ?? ""}
                  onChange={(e) => update("validUntil", e.target.value || null)}
                  className={inputClass}
                />
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive !== false}
                onChange={(e) => update("isActive", e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-900">فعّال</span>
            </label>
          </div>
          <div className="p-4 border-t flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}