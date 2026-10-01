"use client";

import type { InvoiceAddress, InvoiceItem } from "@/lib/orders/invoice-types";
import { useState } from "react";
import { Printer, Download, Loader2 } from "lucide-react";
import { error as logError } from "@/lib/logger";
// PDF rendering happens on the server via
// /api/v1/orders/[id]/invoice-pdf (Node runtime). This component is just
// a thin client: trigger print, or fetch the binary and hand it to the
// browser. No @react-pdf/renderer in the client bundle.
import { useToast } from "@/components/ui/toast";

/**
 * Customer/admin-facing Print + Download PDF buttons for an order.
 *
 * The download flow hits the server endpoint
 * `/api/v1/orders/[id]/invoice-pdf`, which uses the same RTL layout +
 * Arabic font as the in-page UI. The print flow goes through the
 * browser's native print dialog (which offers "Save as PDF" on every
 * modern engine), so we don't need a second artifact for that case.
 *
 * Operator decision (2026-09-20): print + PDF download were added on
 * top of the order detail surface so customers and admins can archive
 * receipts without depending on email.
 */

type InvoiceActionsItem = InvoiceItem;
type InvoiceActionsAddress = InvoiceAddress;

interface InvoiceActionsProps {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerPhone?: string | null;
  address?: InvoiceActionsAddress | null;
  items: InvoiceActionsItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  total: number;
  variant?: "customer" | "admin";
  className?: string;
}

function shortOrderNumber(s: string): string {
  // Strip UUID dashes; if too long, keep the last 8 (matches the
  // customer-friendly compact id already used elsewhere in the app).
  const cleaned = (s || "").replace(/-/g, "");
  if (!cleaned) return s;
  return cleaned.length > 8 ? cleaned.slice(-8).toUpperCase() : cleaned.toUpperCase();
}

export function InvoiceActions(props: InvoiceActionsProps) {
  const {
    orderNumber,
    orderId,
    variant = "customer",
    className,
  } = props;

  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handlePrint = () => {
    try {
      window.print();
    } catch {
      showToast("تعذّر فتح نافذة الطباعة", "error");
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Server renders the PDF (with NotoSansArabic + RTL layout) and
      // returns the binary. The server endpoint enforces ownership for
      // customers and `manage_orders` for admins.
      const res = await fetch(
        `/api/v1/orders/${encodeURIComponent(orderId)}/invoice-pdf`,
        { credentials: "include" }
      );
      if (!res.ok) {
        let msg = "تعذّر إنشاء ملف PDF. حاول مرة أخرى.";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        showToast(msg, "error");
        return;
      }
      const blob = await res.blob();
      // Trust the server's Content-Disposition when present (it carries
      // the customer-friendly `invoice-{short}.pdf`), but fall back to
      // our own derivation if the header got stripped by a proxy.
      const disp = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^";]+)"?/.exec(disp);
      const filename = m?.[1] || `invoice-${shortOrderNumber(orderNumber)}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // Audit I39: canonical logger.
      logError("[invoice-actions] PDF generation failed", err);
      showToast("تعذّر إنشاء ملف PDF. حاول مرة أخرى.", "error");
    } finally {
      setDownloading(false);
    }
  };

  const baseBtn =
    "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${
        className ?? ""
      }`}
      data-testid="invoice-actions"
      data-variant={variant}
    >
      <button
        type="button"
        onClick={handlePrint}
        disabled={downloading}
        className={`${baseBtn} bg-slate-100 text-slate-800 hover:bg-slate-200 print:hidden`}
        data-testid="invoice-print"
        aria-label="طباعة الفاتورة"
      >
        <Printer className="w-4 h-4" />
        طباعة
      </button>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className={`${baseBtn} bg-primary text-white hover:bg-primary-dark print:hidden`}
        data-testid="invoice-download"
        aria-label="تحميل الفاتورة كملف PDF"
      >
        {downloading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري الإنشاء…
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            تحميل PDF
          </>
        )}
      </button>
    </div>
  );
}

export default InvoiceActions;