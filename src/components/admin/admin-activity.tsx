"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Download,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/admin/modal";
import { error as logError } from "@/lib/logger";

const adminCred: RequestInit = { credentials: "include" };
const PAGE_SIZE = 50;

type ActivityRow = {
  id: string | number;
  admin_id?: string | null;
  admin_email?: string | null;
  admin_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
};

type Filters = {
  admin_email: string;
  action: string;
  entity_type: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  admin_email: "",
  action: "",
  entity_type: "",
  from: "",
  to: "",
};

/**
 * Admin audit log screen. Filters live entirely in URL-less local state —
 * audit screens are used reactively rather than linked to, so the URL
 * stays clean and admins don't bookmark filtered slices by mistake.
 *
 * Heavy enough that we memoize the column definitions and details
 * serialization; the table itself can hold hundreds of rows.
 */
export function AdminActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [detailsRow, setDetailsRow] = useState<ActivityRow | null>(null);
  const { showToast } = useToast();

  const load = useCallback(
    async (signal?: AbortSignal, overrideFilters?: Filters, overrideOffset?: number) => {
      const f = overrideFilters ?? appliedFilters;
      const o = overrideOffset ?? offset;
      setLoading(true);
      try {
        const qs = buildQueryString(f, PAGE_SIZE, o);
        const res = await fetch(`/api/admin/activity?${qs}`, {
          ...adminCred,
          signal,
        }).then((r) => r.json());
        if (signal?.aborted) return;
        if (res.success) {
          setRows(res.data);
          setTotal(res.pagination?.total ?? 0);
        } else {
          showToast(res.error || "فشل جلب السجل", "error");
        }
      } catch (e) {
        if (!signal?.aborted) {
          // Audit I39: canonical logger.
          logError("admin-activity fetch", e);
          showToast("تعذّر الاتصال بالخادم", "error");
        }
      }
      if (!signal?.aborted) setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedFilters, offset]
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const applyFilters = () => {
    setOffset(0);
    setAppliedFilters(filters);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const hasActiveFilters = useMemo(
    () => Object.values(appliedFilters).some((v) => v.trim() !== ""),
    [appliedFilters]
  );

  const exportCsv = async () => {
    try {
      // Export honours the *applied* filters so the CSV matches what the
      // admin currently sees — useful for "give me everything 'store.*'
      // by ali@ last week". Capped at 500 by the API.
      const qs = buildQueryString(appliedFilters, 500, 0) + "&format=csv";
      const res = await fetch(`/api/admin/activity?${qs}`, adminCred);
      if (!res.ok) throw new Error("فشل التصدير");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `admin-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("تم تنزيل ملف CSV", "success");
    } catch (e) {
      // Audit I39: canonical logger.
      logError("admin-activity CSV export", e);
      showToast("فشل تصدير CSV", "error");
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "admin",
        label: "المدير",
        render: (r: ActivityRow) => (
          <div>
            <div className="font-medium text-secondary">
              {r.admin_name || r.admin_email || "—"}
            </div>
            {r.admin_name && r.admin_email ? (
              <div className="text-[11px] text-gray-500" dir="ltr">
                {r.admin_email}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: "action",
        label: "الإجراء",
        render: (r: ActivityRow) => (
          <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-xs font-mono">
            {r.action}
          </span>
        ),
      },
      {
        key: "entity",
        label: "الكيان",
        render: (r: ActivityRow) =>
          r.entity_type ? (
            <div>
              <div className="text-xs text-gray-700">{r.entity_type}</div>
              {r.entity_id ? (
                <div className="text-[10px] text-gray-400 font-mono" dir="ltr">
                  {String(r.entity_id).slice(0, 12)}…
                </div>
              ) : null}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: "ip",
        label: "IP",
        render: (r: ActivityRow) =>
          r.ip_address ? (
            <span className="text-[11px] font-mono text-gray-500" dir="ltr">
              {r.ip_address}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: "created_at",
        label: "الوقت",
        render: (r: ActivityRow) => (
          <span className="text-xs text-gray-600">
            {new Date(r.created_at).toLocaleString("ar-SA")}
          </span>
        ),
      },
      {
        key: "details",
        label: "",
        render: (r: ActivityRow) => (
          <button
            type="button"
            onClick={() => setDetailsRow(r)}
            className="p-1.5 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            aria-label="عرض التفاصيل"
          >
            <Eye className="w-4 h-4" />
          </button>
        ),
      },
    ],
    []
  );

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + rows.length, total);

  return (
    <div className="space-y-4">
      {/* Filter bar — sticky-styled card above the table. */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-bold text-secondary">فلترة السجل</h2>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                مسح
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            تصدير CSV
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={filters.admin_email}
            onChange={(e) =>
              setFilters((f) => ({ ...f, admin_email: e.target.value }))
            }
            placeholder="البريد الإلكتروني للمدير"
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
            dir="ltr"
          />
          <input
            type="text"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            placeholder="الإجراء (مثل store.*)"
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
            dir="ltr"
          />
          <input
            type="text"
            value={filters.entity_type}
            onChange={(e) =>
              setFilters((f) => ({ ...f, entity_type: e.target.value }))
            }
            placeholder="نوع الكيان"
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
          />
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
            title="من تاريخ"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
            title="إلى تاريخ"
          />
        </div>
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={applyFilters}
            className="px-4 py-2 bg-secondary text-white text-sm font-medium rounded-xl hover:bg-secondary/90 transition-colors"
          >
            تطبيق
          </button>
        </div>
      </div>

      {/* Table with pagination footer. */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <DataTable
          title="سجل نشاط الموظفين"
          columns={columns}
          data={rows}
          loading={loading}
        />
        {total > 0 ? (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
            <div>
              عرض {pageStart}–{pageEnd} من {total} سجل
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-white disabled:opacity-40"
              >
                <ChevronRight className="w-3 h-3" />
                السابق
              </button>
              <button
                type="button"
                disabled={offset + rows.length >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-white disabled:opacity-40"
              >
                التالي
                <ChevronLeft className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Row details — only renders when an eye icon is clicked. */}
      <Modal
        isOpen={!!detailsRow}
        onClose={() => setDetailsRow(null)}
        title="تفاصيل الحدث"
        description={
          detailsRow
            ? `${detailsRow.action} • ${new Date(detailsRow.created_at).toLocaleString("ar-SA")}`
            : undefined
        }
        size="lg"
      >
        {detailsRow ? (
          <div className="space-y-3 text-sm">
            <Row label="المدير">
              {detailsRow.admin_name || "—"}
              {detailsRow.admin_email ? (
                <span className="text-gray-500 text-xs" dir="ltr">
                  {" "}
                  ({detailsRow.admin_email})
                </span>
              ) : null}
            </Row>
            <Row label="الإجراء" mono>
              {detailsRow.action}
            </Row>
            <Row label="الكيان">
              {detailsRow.entity_type
                ? `${detailsRow.entity_type}${detailsRow.entity_id ? ` / ${detailsRow.entity_id}` : ""}`
                : "—"}
            </Row>
            <Row label="IP">{detailsRow.ip_address || "—"}</Row>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">
                التفاصيل
              </div>
              <pre
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono whitespace-pre-wrap break-all"
                dir="ltr"
              >
                {JSON.stringify(detailsRow.details ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
      <div
        className={`text-secondary ${mono ? "font-mono text-xs" : ""}`}
        dir={mono ? "ltr" : undefined}
      >
        {children}
      </div>
    </div>
  );
}

function buildQueryString(f: Filters, limit: number, offset: number): string {
  const p = new URLSearchParams();
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  if (f.admin_email) p.set("admin_email", f.admin_email);
  if (f.action) p.set("action", f.action);
  if (f.entity_type) p.set("entity_type", f.entity_type);
  if (f.from) p.set("from", `${f.from}T00:00:00.000Z`);
  if (f.to) p.set("to", `${f.to}T23:59:59.999Z`);
  return p.toString();
}