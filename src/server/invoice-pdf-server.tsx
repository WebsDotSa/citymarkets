/**
 * Server-side invoice PDF renderer.
 *
 * Why a separate module from the retired `src/components/orders/invoice-pdf.tsx`?
 * The client-side version used `Font.register({ src: "/fonts/..." })` so
 * @react-pdf/renderer could fetch() the fonts in the browser. On the
 * server, we already have the bytes on disk — `node:fs` is faster, more
 * reliable, and doesn't need an HTTP round-trip. The client component
 * was retired in refactor/full-repository-consolidation Phase A2; this
 * server module is the canonical renderer.
 *
 * The rendered JSX is identical to the client component so customers
 * and admins get the same layout regardless of which path triggered
 * the download.
 */
import * as React from "react";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import {
  Document,
  Page,
  Text,
  View,
  Image,
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

// Resolve the site logo at module load. The PDF renderer renders the
// image inline (data URI) so the runtime never needs to fetch anything.
// If no logo file is found, the renderer falls back to text-only — the
// brand name still appears in the header so the document stays valid.
function resolveSiteLogoDataUri(): string | null {
  const candidates = [
    path.join(process.cwd(), "public", "citymarket-logo.png"),
    path.join(process.cwd(), "public", "images", "city-markets-logo.png"),
    path.resolve(__dirname, "..", "..", "..", "public", "citymarket-logo.png"),
    path.resolve(
      __dirname,
      "..",
      "..",
      "public",
      "citymarket-logo.png",
    ),
    "/app/public/citymarket-logo.png",
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const bytes = fs.readFileSync(file);
        return `data:image/png;base64,${bytes.toString("base64")}`;
      }
    } catch {
      // continue searching
    }
  }
  return null;
}

const LOGO_DATA_URI = resolveSiteLogoDataUri();

/** Build a QR code PNG data URI for the tracking URL. Returns null on failure. */
async function buildTrackingQrPngDataUri(url: string): Promise<string | null> {
  try {
    const pngBuffer = await QRCode.toBuffer(url, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#009345", light: "#ffffff" },
    });
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

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
  // Tracking path / order tracking section (مسار الطلب)
  trackingCode?: string | null;
  trackingUrl?: string | null;
  /** Pre-built PNG data URI for the tracking URL QR code. */
  trackingQrPngDataUri?: string | null;
  /** Optional order lifecycle progression (e.g. pending → confirmed → delivered). */
  trackingSteps?: Array<{ key: string; label: string; reached?: boolean }>;
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
  // ── Header logo + tracking path styles ─────────────────────────────
  logo: {
    width: 64,
    height: 64,
    objectFit: "contain",
    marginBottom: 4,
  },
  brandBlock: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  trackingCard: {
    backgroundColor: "#E6F5EC",
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: "#C7E8D2",
    marginBottom: 10,
  },
  trackingRow: {
    flexDirection: "row-reverse",
    gap: 12,
    alignItems: "flex-start",
  },
  trackingInfo: {
    flex: 1,
  },
  trackingQr: {
    width: 96,
    height: 96,
    objectFit: "contain",
  },
  trackingUrl: {
    fontSize: 9,
    color: "#047857",
    fontWeight: 700,
    marginTop: 4,
    textAlign: "right",
    direction: "ltr",
  },
  trackingCodeMono: {
    fontSize: 13,
    fontWeight: 700,
    color: "#111827",
    textAlign: "right",
    letterSpacing: 1,
  },
  stepRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stepDotReached: { backgroundColor: "#009345" },
  stepDotPending: { backgroundColor: "#e5e7eb" },
  stepLabel: { fontSize: 9, color: "#374151" },
  stepLabelPending: { color: "#9ca3af" },
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
    trackingCode,
    trackingUrl,
    trackingQrPngDataUri,
    trackingSteps,
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
          <View style={styles.brandBlock}>
            {LOGO_DATA_URI ? (
              <Image src={LOGO_DATA_URI} style={styles.logo} />
            ) : null}
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

        {(trackingCode || trackingUrl || (trackingSteps && trackingSteps.length > 0)) ? (
          <>
            <Text style={styles.sectionTitle}>مسار الطلب</Text>
            <View style={styles.trackingCard}>
              <View style={styles.trackingRow}>
                <View style={styles.trackingInfo}>
                  {trackingCode ? (
                    <>
                      <Text style={styles.infoTitle}>رقم التتبع</Text>
                      <Text style={styles.trackingCodeMono}>
                        {trackingCode}
                      </Text>
                    </>
                  ) : null}
                  {trackingUrl ? (
                    <>
                      <Text style={[styles.infoTitle, { marginTop: 6 }]}>
                        رابط المتابعة
                      </Text>
                      <Text style={styles.trackingUrl}>{trackingUrl}</Text>
                    </>
                  ) : null}
                </View>
                {trackingQrPngDataUri ? (
                  <Image
                    src={trackingQrPngDataUri}
                    style={styles.trackingQr}
                  />
                ) : null}
              </View>
              {trackingSteps && trackingSteps.length > 0 ? (
                <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#C7E8D2" }}>
                  {trackingSteps.map((s) => (
                    <View key={s.key} style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepDot,
                          s.reached ? styles.stepDotReached : styles.stepDotPending,
                        ]}
                      />
                      <Text
                        style={[
                          styles.stepLabel,
                          !s.reached ? styles.stepLabelPending : undefined,
                        ]}
                      >
                        {s.label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

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
 *
 * If `props.trackingUrl` is set and `props.trackingQrPngDataUri` is NOT
 * already populated, a QR code will be generated and embedded
 * automatically — callers that already pre-built the QR can pass it in.
 */
export async function renderInvoicePdf(
  props: ServerInvoiceProps,
): Promise<Buffer> {
  let qrDataUri = props.trackingQrPngDataUri ?? null;
  if (!qrDataUri && props.trackingUrl) {
    qrDataUri = await buildTrackingQrPngDataUri(props.trackingUrl);
  }
  return renderToBuffer(
    <InvoicePdfServer
      {...props}
      trackingQrPngDataUri={qrDataUri ?? undefined}
    />,
  );
}

/** Exposed so callers (the invoice route) can pre-compute if desired. */
export const buildTrackingQr = buildTrackingQrPngDataUri;

/** Short, customer-friendly invoice filename: `invoice-ABC12345.pdf`. */
export function invoiceFilename(orderNumber: string): string {
  const cleaned = (orderNumber || "").replace(/-/g, "");
  const short =
    cleaned.length > 8 ? cleaned.slice(-8).toUpperCase() : cleaned.toUpperCase();
  return `invoice-${short || "order"}.pdf`;
}
