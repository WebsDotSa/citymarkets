"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { RefreshCw, ExternalLink } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { error as logError } from "@/lib/logger";

const adminCred: RequestInit = { credentials: "include" };

type PaymentRow = {
  id: string;
  order_id: string;
  amount: number | string;
  currency?: string;
  status: string;
  payment_method?: string;
  provider?: string;
  created_at: string;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

export function AdminPayments() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [moyasarConfigured, setMoyasarConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const { showToast } = useToast();

  const load = async (verify = false) => {
    if (verify) setVerifying(true);
    else setLoading(true);
    try {
      const q = verify ? "?verify=1&limit=100" : "?limit=100";
      const res = await fetch(`/api/admin/payments${q}`, adminCred).then((r) => r.json());
      if (res.success) {
        setRows(res.data);
        setSummary(res.summary);
        setMoyasarConfigured(res.moyasarConfigured);
      }
    } catch (e) {
      // Audit I39: canonical logger.
      logError("admin-payments fetch", e);
      showToast("فشل تحميل المدفوعات", "error");
    }
    setLoading(false);
    setVerifying(false);
  };

  useEffect(() => {
    load();
  }, []);

  const columns = [
    {
      key: "id",
      label: "رقم الطلب",
      render: (r: any) => (
        <Link href={`/admin/orders/${r.id}`} className="text-primary-600 hover:underline">
          #{r.id}
        </Link>
      ),
    },
    { key: "customer_name", label: "العميل" },
    { key: "total", label: "المبلغ", render: (r: any) => formatPrice(r.total) },
    { key: "payment_method", label: "الطريقة" },
    { key: "payment_status", label: "حالة الدفع" },
    { key: "payment_reference", label: "مرجع ميسر" },
    {
      key: "moyasar_match",
      label: "مطابقة",
      render: (r: any) =>
        r.moyasar_match === "ok" ? (
          <span className="text-primary-600">متطابق</span>
        ) : r.moyasar_match === "mismatch" ? (
          <span className="text-red-600">اختلاف</span>
        ) : r.moyasar_match ? (
          <span className="text-gray-500">{String(r.moyasar_match)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "created_at",
      label: "التاريخ",
      render: (r: any) => new Date(r.created_at).toLocaleString("ar-SA"),
    },
  ];

  return (
    <div>
      {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Stat label="طلبات إلكترونية" value={Number(summary.electronic_orders ?? 0)} />
            <Stat
              label="إيراد مؤكد ومدفوع"
              value={formatPrice(Number(summary.confirmed_paid_revenue ?? 0))}
            />
            <Stat label="مدفوعة" value={Number(summary.paid_count ?? 0)} />
            <Stat label="معلّقة / فاشلة" value={`${summary.pending_count} / ${summary.failed_count}`} />
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            type="button"
            onClick={() => load(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> تحديث
          </button>
          {moyasarConfigured && (
            <button
              type="button"
              disabled={verifying}
              onClick={() => load(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <ExternalLink className="w-4 h-4" />
              {verifying ? "جاري المطابقة مع ميسر…" : "مطابقة أول 30 مع ميسر"}
            </button>
          )}
          {!moyasarConfigured && (
            <p className="text-sm text-amber-700 self-center">
              مفاتيح ميسر غير مضبوطة — المطابقة التلقائية غير متاحة.
            </p>
          )}
        </div>

        <DataTable
          title="المدفوعات الإلكترونية"
          columns={columns}
          data={rows}
          loading={loading}
        />
      </div>
  );
}
