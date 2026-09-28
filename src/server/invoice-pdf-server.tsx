/**
 * Server-side invoice PDF renderer.
 *
 * Why a separate module from `src/components/orders/invoice-pdf.tsx`?
 * The client-side version uses `Font.register({ src: "/fonts/..." })` so
 * @react-pdf/renderer can fetch() the fonts in the browser. On the
 * server, we already have the bytes on disk — `node:fs` is faster, more
 * reliable, and doesn't need an HTTP round-trip. Splitting the two also
 * keeps the bundler from pulling the browser Font registration into the
 * server bundle (and vice versa).
 *
 * The rendered JSX is identical to the client component so customers
 * and admins get the same layout regardless of which path triggered
 * the download.
 */
import * as React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";

// Resolve the public/fonts dir relative to the project root. We can't
// use `process.cwd()` in container builds because the entry path varies,
// so anchor on `__dirname`-relative search instead. Public files in
// Next.js sit alongside package.json at the repo root.
function resolvePublicFontsDir(): string {
  const candidates = [
    path.join(process.cwd(), "public", "fonts"),
    path.resolve(__dirname, "..", "..", "..", "public", "fonts"),
    path.resolve(__dirname, "..", "..", "public", "fonts"),
    "/app/public/fonts",
  ];
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "NotoSansArabic-Regular.ttf")) &&
      fs.existsSync(path.join(dir, "NotoSansArabic-Bold.ttf"))
    ) {
      return dir;
    }
  }
  throw new Error(
    `invoice-pdf-server: NotoSansArabic TTFs not found. Searched: ${candidates.join(", ")}`,
  );
}

// Register Arabic fonts once at module load. `data:font/ttf;base64,...`
// is the @react-pdf/renderer server-side format: pass the bytes inline
// so the renderer never needs to fetch anything at runtime.
const FONTS_DIR = resolvePublicFontsDir();
Font.register({
  family: "NotoSansArabic",
  fonts: [
    {
      src: `data:font/ttf;base64,${fs.readFileSync(
        path.join(FONTS_DIR, "NotoSansArabic-Regular.ttf"),
      ).toString("base64")}`,
      fontWeight: 400,
    },
    {
      src: `data:font/ttf;base64,${fs.readFileSync(
        path.join(FONTS_DIR, "NotoSansArabic-Bold.ttf"),
      ).toString("base64")}`,
      fontWeight: 700,
    },
  ],
});

export interface ServerInvoiceItem {
  name: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
}

export interface ServerInvoiceAddress {
  label?: string | null;
  text?: string | null;
  city?: string | null;
  district?: string | null;
}

export interface ServerInvoiceProps {
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentMethodLabel: string;
  paymentStatus: string;
  paymentStatusLabel: string;
  customerName: string;
  customerPhone?: string | null;
  address?: ServerInvoiceAddress | null;
  items: ServerInvoiceItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  total: number;
  storeName?: string;
  variant: "customer" | "admin";
}

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontFamily: "NotoSansArabic",
    fontSize: 10,
    color: "#1f2937",
    direction: "rtl",
  },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    color: "#009345",
    textAlign: "right",
  },
  brandSub: {
    fontSize: 9,
    color: "#6b7280",
    marginTop: 2,
    textAlign: "right",
  },
  invoiceTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#111827",
    textAlign: "left",
  },
  invoiceMeta: {
    fontSize: 9,
    color: "#6b7280",
    marginTop: 2,
    textAlign: "left",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#374151",
    marginTop: 12,
    marginBottom: 6,
    textAlign: "right",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    paddingBottom: 4,
  },
  rowBetween: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  rowLabel: { color: "#6b7280", fontSize: 10 },
  rowValue: { color: "#111827", fontSize: 10, fontWeight: 700 },
  twoCol: {
    flexDirection: "row-reverse",
    gap: 16,
    marginBottom: 12,
  },
  col: { flex: 1 },
  infoCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 6,
    padding: 10,
  },
  infoTitle: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 2,
    textAlign: "right",
  },
  infoValue: {
    fontSize: 10,
    color: "#111827",
    textAlign: "right",
  },
  table: {
    marginTop: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  tableHead: {
    flexDirection: "row-reverse",
    backgroundColor: "#f3f4f6",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontWeight: 700,
    fontSize: 9,
  },
  tableHeadCell: { color: "#374151" },
  tableRow: {
    flexDirection: "row-reverse",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  colName: { flex: 3, textAlign: "right" },
  colQty: { flex: 1, textAlign: "center" },
  colUnit: { flex: 1.5, textAlign: "left" },
  colTotal: { flex: 1.5, textAlign: "left", fontWeight: 700 },
  totalsBlock: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  grandTotal: {
    fontSize: 14,
    fontWeight: 700,
    color: "#009345",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 8,
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 9,
    fontWeight: 700,
  },
  pillPaid: { backgroundColor: "#d1fae5", color: "#047857" },
  pillPending: { backgroundColor: "#fef3c7", color: "#92400e" },
  pillFailed: { backgroundColor: "#fee2e2", color: "#b91c1c" },
  pillDefault: { backgroundColor: "#e5e7eb", color: "#374151" },
});

function formatPrice(value: number): string {
  // Local copy of `@/lib/utils.formatPrice` that keeps an explicit
  // Math.round to avoid IEEE-754 drift in PDF line items. The canonical
  // helper in src/lib/utils.ts does NOT round before formatting; PDF
  // totals are summed across many rows so any drift compounds.
  // Keep this signature in sync with src/lib/utils.ts.
  return `${(Math.round(value * 100) / 100).toFixed(2)} ر.س`;
}

function paymentPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid" || s === "completed") return "pillPaid";
  if (s === "failed") return "pillFailed";
  if (s === "pending" || s === "unpaid") return "pillPending";
  return "pillDefault";
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ar-SA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function InvoicePdfServer(props: ServerInvoiceProps) {
  const {
    orderNumber,
    createdAt,
    status,
    paymentMethodLabel,
    paymentStatus,
    paymentStatusLabel,
    customerName,
    customerPhone,
    address,
    items,
    subtotal,
    deliveryFee,
    serviceFee,
    tax,
    discount,
    total,
    storeName = "أسواق سيتي",
    variant,
  } = props;

  const pillClass = paymentPillClass(paymentStatus);
  const pillStyles = styles[pillClass as keyof typeof styles] as
    | typeof styles.pillPaid
    | typeof styles.pillPending
    | typeof styles.pillFailed
    | typeof styles.pillDefault;

  return (
    <Document
      title={`فاتورة-${orderNumber}`}
      author={storeName}
      subject={`فاتورة طلب رقم ${orderNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{storeName}</Text>
            <Text style={styles.brandSub}>منصة التسوق الذكية</Text>
          </View>
          <View>
            <Text style={styles.invoiceTitle}>فاتورة</Text>
            <Text style={styles.invoiceMeta}>
              رقم الطلب: {orderNumber}
            </Text>
            <Text style={styles.invoiceMeta}>{fmtDate(createdAt)}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={[styles.col, styles.infoCard]}>
            <Text style={styles.infoTitle}>حالة الطلب</Text>
            <Text style={styles.infoValue}>{status}</Text>
          </View>
          <View style={[styles.col, styles.infoCard]}>
            <Text style={styles.infoTitle}>طريقة الدفع</Text>
            <Text style={styles.infoValue}>{paymentMethodLabel}</Text>
            <View style={{ marginTop: 4, flexDirection: "row-reverse" }}>
              <Text
                style={[
                  styles.pill,
                  pillStyles ?? styles.pillDefault,
                ]}
              >
                {paymentStatusLabel}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>بيانات العميل</Text>
        <View style={styles.twoCol}>
          <View style={[styles.col, styles.infoCard]}>
            <Text style={styles.infoTitle}>الاسم</Text>
            <Text style={styles.infoValue}>{customerName}</Text>
            {customerPhone ? (
              <>
                <Text style={[styles.infoTitle, { marginTop: 4 }]}>
                  رقم الجوال
                </Text>
                <Text style={styles.infoValue}>{customerPhone}</Text>
              </>
            ) : null}
          </View>
          <View style={[styles.col, styles.infoCard]}>
            <Text style={styles.infoTitle}>عنوان التوصيل</Text>
            <Text style={styles.infoValue}>{address?.label || "—"}</Text>
            <Text
              style={[
                styles.infoValue,
                { marginTop: 2, fontSize: 9, color: "#6b7280" },
              ]}
            >
              {address?.text || ""}
              {address?.district ? ` — ${address.district}` : ""}
              {address?.city ? ` — ${address.city}` : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>العناصر</Text>
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colName, styles.tableHeadCell]}>المنتج</Text>
            <Text style={[styles.colQty, styles.tableHeadCell]}>الكمية</Text>
            <Text style={[styles.colUnit, styles.tableHeadCell]}>السعر</Text>
            <Text style={[styles.colTotal, styles.tableHeadCell]}>الإجمالي</Text>
          </View>
          {items.map((it, i) => (
            <View key={`${it.name}-${i}`} style={styles.tableRow}>
              <Text style={styles.colName}>
                {it.name}
                {it.notes ? `\n${it.notes}` : ""}
              </Text>
              <Text style={styles.colQty}>{it.quantity}</Text>
              <Text style={styles.colUnit}>{formatPrice(it.unit_price)}</Text>
              <Text style={styles.colTotal}>
                {formatPrice(it.unit_price * it.quantity)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>المجموع الفرعي</Text>
            <Text style={styles.rowValue}>{formatPrice(subtotal)}</Text>
          </View>
          {deliveryFee > 0 ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>رسوم التوصيل</Text>
              <Text style={styles.rowValue}>{formatPrice(deliveryFee)}</Text>
            </View>
          ) : null}
          {serviceFee > 0 ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>رسوم الخدمة</Text>
              <Text style={styles.rowValue}>{formatPrice(serviceFee)}</Text>
            </View>
          ) : null}
          {tax > 0 ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>ضريبة القيمة المضافة</Text>
              <Text style={styles.rowValue}>{formatPrice(tax)}</Text>
            </View>
          ) : null}
          {discount > 0 ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>الخصم</Text>
              <Text
                style={[styles.rowValue, { color: "#059669" }]}
              >
                -{formatPrice(discount)}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.rowBetween,
              {
                marginTop: 8,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: "#e5e7eb",
              },
            ]}
          >
            <Text style={styles.grandTotal}>الإجمالي</Text>
            <Text style={styles.grandTotal}>{formatPrice(total)}</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {variant === "admin"
            ? "نسخة الإدارة — تم إصدار هذه الفاتورة آلياً عبر نظام أسواق سيتي"
            : "شكراً لتسوقك من أسواق سيتي — للملاحظات يرجى التواصل عبر التطبيق"}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render the invoice PDF server-side. Returns a Node Buffer ready to be
 * streamed as `application/pdf`.
 */
export async function renderInvoicePdf(
  props: ServerInvoiceProps,
): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfServer {...props} />);
}

/** Short, customer-friendly invoice filename: `invoice-ABC12345.pdf`. */
export function invoiceFilename(orderNumber: string): string {
  const cleaned = (orderNumber || "").replace(/-/g, "");
  const short =
    cleaned.length > 8 ? cleaned.slice(-8).toUpperCase() : cleaned.toUpperCase();
  return `invoice-${short || "order"}.pdf`;
}
