"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Download, Search, FileText, Loader2, CheckCircle2, XCircle, Clock, Star, Inbox, Bike, UserCheck } from "lucide-react";
import { safeFetchJson } from "@/lib/safe-fetch";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";

type Status = "new" | "reviewed" | "shortlisted" | "rejected" | "hired";
type JobFilter = "all" | "delivery" | "non-delivery";

type Application = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  job_id: string;
  job_title: string;
  message: string | null;
  cv_url: string;
  cv_filename: string;
  cv_size_bytes: number;
  status: Status;
  internal_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const STATUS_META: Record<Status, { label: string; color: string; icon: typeof Inbox }> = {
  new: { label: "جديد", color: "bg-blue-50 text-blue-700 border-blue-200", icon: Inbox },
  reviewed: { label: "تمت المراجعة", color: "bg-gray-50 text-gray-700 border-gray-200", icon: CheckCircle2 },
  shortlisted: { label: "مرشح للقائمة", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Star },
  rejected: { label: "مرفوض", color: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
  hired: { label: "تم التعيين", color: "bg-primary-50 text-primary-700 border-primary-200", icon: CheckCircle2 },
};

const adminCred: RequestInit = { credentials: "include" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ب`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function AdminEmployment() {
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<Status, number>>({
    new: 0, reviewed: 0, shortlisted: 0, rejected: 0, hired: 0,
  });
  const [total, setTotal] = useState(0);
  const [delegateTotal, setDelegateTotal] = useState(0);
  const { showToast } = useToast();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (jobFilter === "delivery") params.set("job_id", "delivery");
    if (jobFilter === "non-delivery") params.set("job_id", "non-delivery");
    if (search.trim()) params.set("q", search.trim());
    const url = `/api/admin/employment${params.toString() ? `?${params}` : ""}`;
    const res = await safeFetchJson<{
      success: boolean;
      data: Application[];
      summary: { total: number; counts: Record<Status, number> };
    }>(url, { ...adminCred, signal });
    if (signal?.aborted) return;
    if (res?.success) {
      setRows(res.data);
      setCounts(res.summary.counts);
      setTotal(res.summary.total);
    } else {
      showToast("فشل تحميل الطلبات", "error");
    }
    setLoading(false);
  };

  // Load delegate-only count once for the tab badge
  useEffect(() => {
    const ac = new AbortController();
    safeFetchJson<{ success: boolean; summary: { total: number } }>(
      "/api/admin/employment?job_id=delivery",
      { ...adminCred, signal: ac.signal }
    )
      .then((res) => {
        if (!ac.signal.aborted && res?.success) {
          setDelegateTotal(res.summary.total);
        }
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, jobFilter]);

  // Debounced search reload
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => load(ac.signal), 350);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active = useMemo(
    () => rows.find((r) => r.id === activeId) ?? null,
    [rows, activeId]
  );

  const updateApp = async (id: string, patch: Partial<Pick<Application, "status" | "internal_notes">>) => {
    setSavingId(id);
    const res = await csrfFetch("/api/admin/employment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
      ...adminCred,
    }).then((r) => r.json());
    setSavingId(null);
    if (res.success) {
      showToast("تم الحفظ", "success");
      load();
    } else {
      showToast(res.error || "فشل الحفظ", "error");
    }
  };

  const acceptDelegate = async (id: string) => {
    await updateApp(id, { status: "hired" });
  };

  const rejectDelegate = async (id: string) => {
    await updateApp(id, { status: "rejected" });
  };

  const tabs: { id: "all" | Status; label: string; count: number }[] = [
    { id: "all", label: "الكل", count: total },
    { id: "new", label: STATUS_META.new.label, count: counts.new },
    { id: "reviewed", label: STATUS_META.reviewed.label, count: counts.reviewed },
    { id: "shortlisted", label: STATUS_META.shortlisted.label, count: counts.shortlisted },
    { id: "hired", label: STATUS_META.hired.label, count: counts.hired },
    { id: "rejected", label: STATUS_META.rejected.label, count: counts.rejected },
  ];

  const jobTabs: { id: JobFilter; label: string; icon: typeof Bike }[] = [
    { id: "all", label: "كل الوظائف", icon: Briefcase },
    { id: "delivery", label: "مناديب التوصيل", icon: Bike },
    { id: "non-delivery", label: "وظائف أخرى", icon: UserCheck },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-primary" />
            طلبات التوظيف
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            السير الذاتية والطلبات المرسلة من صفحة التوظيف
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم، الجوال، الوظيفة..."
            className="w-full h-10 pr-10 pl-3 bg-white border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Job category tabs (Delegates vs Other jobs) */}
      <div className="flex flex-wrap gap-2">
        {jobTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = jobFilter === tab.id;
          const badge =
            tab.id === "delivery"
              ? delegateTotal
              : tab.id === "all"
              ? total
              : Math.max(total - delegateTotal, 0);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setJobFilter(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                isActive
                  ? tab.id === "delivery"
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-gray-800 text-white border-gray-800 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span
                className={`text-2xs px-2 py-0.5 rounded-full ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-colors ${
              statusFilter === tab.id
                ? "bg-white border border-gray-200 border-b-white text-primary"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            <span className="mr-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">جاري التحميل...</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">لا توجد طلبات تطابق البحث</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {rows.map((row) => {
                const meta = STATUS_META[row.status];
                const isActive = activeId === row.id;
                return (
                  <li
                    key={row.id}
                    className={`p-4 cursor-pointer transition-colors ${
                      isActive ? "bg-primary/5 border-r-4 border-primary" : "hover:bg-gray-50"
                    }`}
                    onClick={() => setActiveId(row.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-800 truncate">{row.full_name}</h3>
                          {row.job_id === "delivery" && (
                            <span className="inline-flex items-center gap-1 text-tiny font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              <Bike className="w-3 h-3" />
                              مندوب
                            </span>
                          )}
                          <span className={`text-tiny px-2 py-0.5 rounded-full border ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {row.job_title} • {row.phone}
                        </p>
                        <p className="text-2xs text-gray-400 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(row.created_at)}
                        </p>
                      </div>
                      <a
                        href={row.cv_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1.5 rounded-lg"
                        title="تحميل السيرة الذاتية"
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">CV</span>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 lg:sticky lg:top-4 self-start max-h-[80vh] overflow-y-auto">
          {!active ? (
            <div className="text-center text-gray-400 py-10">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">اختر طلباً لعرض التفاصيل</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-bold text-gray-800">{active.full_name}</h2>
                  {active.job_id === "delivery" && (
                    <span className="inline-flex items-center gap-1 text-tiny font-bold px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                      <Bike className="w-3 h-3" />
                      مندوب توصيل
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{active.job_title}</p>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">الجوال</span>
                  <a href={`tel:${active.phone}`} className="font-semibold text-gray-800 hover:text-primary" dir="ltr">
                    {active.phone}
                  </a>
                </div>
                {active.email && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">البريد</span>
                    <a href={`mailto:${active.email}`} className="font-semibold text-gray-800 hover:text-primary" dir="ltr">
                      {active.email}
                    </a>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">تاريخ التقديم</span>
                  <span className="font-semibold text-gray-800">{formatDate(active.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">حجم السيرة</span>
                  <span className="font-semibold text-gray-800">{formatSize(active.cv_size_bytes)}</span>
                </div>
              </div>

              {active.message && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1">الرسالة</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {active.message}
                  </p>
                </div>
              )}

              <a
                href={active.cv_url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl font-semibold hover:bg-primary-dark transition-colors"
              >
                <Download className="w-4 h-4" />
                تحميل السيرة الذاتية ({active.cv_filename})
              </a>

              {/* Quick Accept / Reject for delegates */}
              {active.job_id === "delivery" && active.status !== "hired" && active.status !== "rejected" && (
                <div className="border-t border-gray-100 pt-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500">إجراءات سريعة للمندوب</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={savingId === active.id}
                      onClick={() => acceptDelegate(active.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                    >
                      {savingId === active.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      قبول المندوب
                    </button>
                    <button
                      type="button"
                      disabled={savingId === active.id}
                      onClick={() => rejectDelegate(active.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      رفض
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500">تغيير الحالة</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(STATUS_META) as Status[]).map((s) => {
                    const meta = STATUS_META[s];
                    const Icon = meta.icon;
                    const isCurrent = active.status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={isCurrent || savingId === active.id}
                        onClick={() => updateApp(active.id, { status: s })}
                        className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold border transition-all ${
                          isCurrent
                            ? `${meta.color} border-current`
                            : "border-gray-200 text-gray-600 hover:border-primary hover:text-primary"
                        } disabled:opacity-50`}
                      >
                        {savingId === active.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Icon className="w-3.5 h-3.5" />
                        )}
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-2">
                <label className="text-xs font-semibold text-gray-500 block">ملاحظات داخلية</label>
                <textarea
                  defaultValue={active.internal_notes ?? ""}
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary focus:bg-white resize-none"
                  placeholder="ملاحظات للفريق (لن تظهر للمتقدم)..."
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== (active.internal_notes ?? "")) {
                      updateApp(active.id, { internal_notes: value });
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
