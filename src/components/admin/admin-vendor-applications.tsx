"use client";

/**
 * Admin review queue for `/vendors/register` submissions.
 *
 * Decisions are taken from a small modal so the admin can:
 *   • Approve → optionally override the auto-generated slug, primary
 *                color, and is_featured flag.
 *   • Reject  → mandatory Arabic reason, optional internal note.
 *   • Note    → internal admin_notes only, no status change.
 *
 * The approve branch atomically creates vendor + vendor_staff +
 * vendor_settings on the server side; this component just reflects
 * the new state from the queue refresh.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Store,
  CheckCircle2,
  XCircle,
  Clock,
  Inbox,
  Loader2,
  AlertCircle,
  ExternalLink,
  Search,
} from "lucide-react";
import { safeFetchJson } from "@/lib/safe-fetch";
import { csrfFetch } from "@/lib/csrf-client";
import { useToast, useConfirm } from "@/components/ui/toast";
import { VENDOR_TYPE_LABELS_AR } from '@/lib/catalog';

type Status = "new" | "approved" | "rejected";

type Application = {
  id: string;
  business_name_ar: string;
  business_name_en: string | null;
  vendor_type: keyof typeof VENDOR_TYPE_LABELS_AR;
  description_ar: string | null;
  description_en: string | null;
  owner_full_name: string;
  owner_email: string;
  owner_phone: string;
  owner_whatsapp: string | null;
  address_ar: string | null;
  pickup_lat: number | string | null;
  pickup_lng: number | string | null;
  city: string | null;
  delivery_mode: "shared" | "own_courier" | "pickup_only";
  accepts_cod: boolean;
  accepts_online_payment: boolean;
  documents: Array<{ kind: string; url: string }> | null;
  status: Status;
  admin_notes: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  approved_vendor_id: string | null;
  created_at: string;
  owner_already_exists: boolean;
};

const STATUS_META: Record<Status, { label: string; chip: string; icon: typeof Inbox }> = {
  new: { label: "جديد", chip: "bg-blue-50 text-blue-700 border-blue-200", icon: Inbox },
  approved: { label: "تمت الموافقة", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  rejected: { label: "مرفوض", chip: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
};

const DELIVERY_LABEL: Record<Application["delivery_mode"], string> = {
  shared: "توصيل عبر أسواق سيتي",
  own_courier: "مندوب خاص بالمتجر",
  pickup_only: "استلام فقط",
};

const adminCred: RequestInit = { credentials: "include" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function AdminVendorApplications() {
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<Status, number>>({
    new: 0,
    approved: 0,
    rejected: 0,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await safeFetchJson<{
      success: boolean;
      data: Application[];
      counts: Record<Status, number>;
    }>(`/api/admin/vendor-applications${params.toString() ? `?${params}` : ""}`, {
      ...adminCred,
      signal,
    });
    if (signal?.aborted) return;
    if (res?.success) {
      setRows(res.data);
      setCounts(res.counts);
    }
    setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.business_name_ar.toLowerCase().includes(q) ||
        (r.business_name_en ?? "").toLowerCase().includes(q) ||
        r.owner_full_name.toLowerCase().includes(q) ||
        r.owner_email.toLowerCase().includes(q) ||
        r.owner_phone.includes(q),
    );
  }, [rows, search]);

  const active = activeId ? rows.find((r) => r.id === activeId) ?? null : null;

  async function refreshAfterChange() {
    setActiveId(null);
    await load();
  }

  async function approve(row: Application) {
    const slugInput = window.prompt(
      `slug للمتجر (اتركه فارغاً لتوليد تلقائي من الاسم):`,
          "",
        );
    if (slugInput === null) return; // cancelled

    const featuredInput = window.confirm(
      "تمييز المتجر وإظهاره في الصفحة الرئيسية؟",
    );

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: "approve",
        is_featured: featuredInput,
      };
      if (slugInput.trim()) payload.slug = slugInput.trim();
      const res = await csrfFetch(
        `/api/admin/vendor-applications/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          ...adminCred,
        },
      ).then((r) => r.json());
      if (!res.success) {
        showToast(res.error || "فشل القبول", "error");
        return;
      }
      showToast(
        `تمت الموافقة على "${row.business_name_ar}". slug: ${res.slug}`,
        "success",
      );
      await refreshAfterChange();
    } finally {
      setSaving(false);
    }
  }

  async function reject(row: Application) {
    const reason = window.prompt("سبب الرفض (يظهر لمقدم الطلب إن قررت إظهاره):");
    if (!reason || !reason.trim()) return;
    setSaving(true);
    try {
      const res = await csrfFetch(
        `/api/admin/vendor-applications/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", rejection_reason: reason.trim() }),
          ...adminCred,
        },
      ).then((r) => r.json());
      if (!res.success) {
        showToast(res.error || "فشل الرفض", "error");
        return;
      }
      showToast("تم رفض الطلب", "success");
      await refreshAfterChange();
    } finally {
      setSaving(false);
    }
  }

  async function deleteApplication(row: Application) {
    if (
      !(await confirm({
        title: "حذف الطلب",
        message: `حذف طلب "${row.business_name_ar}" نهائياً؟ لا يمكن التراجع.`,
        danger: true,
      }))
    )
      return;
    const res = await csrfFetch(
      `/api/admin/vendor-applications?id=${row.id}`,
      {
        method: "DELETE",
        ...adminCred,
      },
    ).then((r) => r.json());
    if (!res.success) {
      showToast(res.error || "فشل الحذف", "error");
    } else {
      showToast("تم حذف الطلب", "success");
      await refreshAfterChange();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">طلبات فتح المتاجر</h1>
          <p className="text-gray-500 text-sm">
            طلبات التسجيل من /vendors/register — مراجعة وقبول أو رفض.
          </p>
        </div>
        <Link
          href="/admin/vendors"
          className="text-sm text-primary hover:underline"
        >
          ← العودة لإدارة المتاجر
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(["all", "new", "approved", "rejected"] as const).map((s) => {
          const active = statusFilter === s;
          const count =
            s === "all"
              ? counts.new + counts.approved + counts.rejected
              : counts[s as Status];
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border whitespace-nowrap transition ${
                active
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
              }`}
            >
              {s === "all"
                ? `الكل (${count})`
                : `${STATUS_META[s].label} (${count})`}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم، الإيميل، الجوال..."
          className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none bg-white"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <Inbox className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">لا توجد طلبات في هذه القائمة.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((row) => {
            const meta = STATUS_META[row.status];
            const Icon = meta.icon;
            return (
              <div
                key={row.id}
                className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 transition p-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Store className="w-6 h-6 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <h3 className="font-bold text-gray-900">
                          {row.business_name_ar}
                          {row.business_name_en && (
                            <span className="text-gray-500 text-sm font-normal me-2">
                              ({row.business_name_en})
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {VENDOR_TYPE_LABELS_AR[row.vendor_type] ?? row.vendor_type} •{" "}
                          {row.city || "—"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border ${meta.chip}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {meta.label}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div>
                        <span className="text-gray-500">المالك: </span>
                        <span className="text-gray-900">{row.owner_full_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">الجوال: </span>
                        <span className="text-gray-900 dir-ltr" dir="ltr">
                          {row.owner_phone}
                        </span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-gray-500">البريد: </span>
                        <span className="text-gray-900 dir-ltr" dir="ltr">
                          {row.owner_email}
                        </span>
                        {row.owner_already_exists && (
                          <span className="ms-2 inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                            <AlertCircle className="w-3 h-3" />
                            يوجد حساب مالك بنفس الإيميل
                          </span>
                        )}
                      </div>
                    </div>

                    {row.description_ar && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                        {row.description_ar}
                      </p>
                    )}

                    {row.admin_notes && (
                      <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        📝 ملاحظة: {row.admin_notes}
                      </div>
                    )}
                    {row.rejection_reason && (
                      <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                        سبب الرفض: {row.rejection_reason}
                      </div>
                    )}
                    {row.approved_vendor_id && (
                      <Link
                        href="/admin/vendors"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                      >
                        تم إنشاء المتجر — عرض في إدارة المتاجر
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}

                    <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(row.created_at)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveId(row.id)}
                          className="text-gray-600 hover:text-primary transition"
                        >
                          التفاصيل
                        </button>
                        {row.status === "new" && (
                          <>
                            <button
                              onClick={() => approve(row)}
                              disabled={saving}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                            >
                              قبول
                            </button>
                            <button
                              onClick={() => reject(row)}
                              disabled={saving}
                              className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition disabled:opacity-50"
                            >
                              رفض
                            </button>
                          </>
                        )}
                        {row.status !== "new" && (
                          <button
                            onClick={() => deleteApplication(row)}
                            className="text-xs text-gray-400 hover:text-red-600 transition"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {active && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setActiveId(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b sticky top-0 bg-white">
              <h2 className="text-xl font-bold text-gray-900">
                {active.business_name_ar}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {VENDOR_TYPE_LABELS_AR[active.vendor_type]}
              </p>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <Section title="المالك">
                <KV k="الاسم" v={active.owner_full_name} />
                <KV k="البريد" v={active.owner_email} dir="ltr" />
                <KV k="الجوال" v={active.owner_phone} dir="ltr" />
                {active.owner_whatsapp && (
                  <KV k="واتساب" v={active.owner_whatsapp} dir="ltr" />
                )}
              </Section>

              <Section title="المتجر">
                {active.business_name_en && (
                  <KV k="الاسم بالإنجليزية" v={active.business_name_en} />
                )}
                {active.description_ar && (
                  <KV k="الوصف" v={active.description_ar} block />
                )}
                {active.address_ar && <KV k="العنوان" v={active.address_ar} />}
                {active.city && <KV k="المدينة" v={active.city} />}
              </Section>

              <Section title="التفضيلات">
                <KV k="طريقة التوصيل" v={DELIVERY_LABEL[active.delivery_mode]} />
                <KV
                  k="الدفع عند الاستلام"
                  v={active.accepts_cod ? "مفعّل" : "غير مفعّل"}
                />
                <KV
                  k="الدفع الإلكتروني"
                  v={active.accepts_online_payment ? "مفعّل" : "غير مفعّل"}
                />
              </Section>

              {active.documents && active.documents.length > 0 && (
                <Section title="المستندات المرفقة">
                  <div className="space-y-1">
                    {active.documents.map((d, i) => (
                      <a
                        key={i}
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-primary hover:underline truncate"
                      >
                        {d.kind}: {d.url}
                      </a>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="الحالة">
                <KV k="تاريخ التقديم" v={formatDate(active.created_at)} />
                {active.reviewed_at && (
                  <KV k="تاريخ المراجعة" v={formatDate(active.reviewed_at)} />
                )}
                {active.admin_notes && (
                  <KV k="ملاحظات الأدمن" v={active.admin_notes} block />
                )}
                {active.rejection_reason && (
                  <KV k="سبب الرفض" v={active.rejection_reason} block />
                )}
              </Section>
            </div>
            <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={() => setActiveId(null)}
                className="px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm.dialog}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
      <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v, block, dir }: { k: string; v: string; block?: boolean; dir?: "ltr" | "rtl" }) {
  if (block) {
    return (
      <div>
        <div className="text-xs text-gray-500 mb-0.5">{k}</div>
        <div className="text-gray-900">{v}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 shrink-0">{k}:</span>
      <span className="text-gray-900 truncate" dir={dir}>
        {v}
      </span>
    </div>
  );
}