"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TicketPercent, ArrowRight, Copy, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

// Shape mirrors the response shape of /api/v1/coupons (which returns the
// currently-active subset of coupons). Both profile-coupons and the cart
// + checkout coupon sections render this data.
export interface AvailableCouponRow {
  code: string;
  type: "percentage" | "fixed" | "free_delivery";
  value: string | number;
  min_order: string | number | null;
  max_discount: string | number | null;
  max_uses: number | null;
  used_count: number | string;
  expires_at: string | Date | null;
}

const TYPE_LABELS: Record<AvailableCouponRow["type"], (v: number | string) => string> = {
  percentage: (v) => `${v}% خصم`,
  fixed: (v) => `${v} ر.س خصم`,
  free_delivery: () => "توصيل مجاني",
};

function describeCoupon(c: AvailableCouponRow): string {
  const head = TYPE_LABELS[c.type](c.value);
  if (c.min_order && Number(c.min_order) > 0) {
    return `${head} على طلبات ${Number(c.min_order)} ر.س أو أكثر`;
  }
  return head;
}

function daysUntil(d: string | Date | null): number | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

interface Props {
  /**
   * "page"   → full-page hero layout, used on /profile/coupons. Each row
   *            shows expiry + use-count metadata + copy button.
   * "inline" → compact list for embedding inside cart + checkout coupon
   *            sections. Adds a "تطبيق" button per row when onApply is
   *            provided; copies on click of the copy icon.
   */
  variant?: "inline" | "page";
  /** Called when the user clicks "تطبيق" on a coupon tile. Inline only. */
  onApply?: (code: string) => void;
  /** Codes the user has already applied (to disable those tiles). */
  appliedCodes?: string[];
  /** Header text shown above the list. Inline only; defaults to "كوبونات متاحة". */
  title?: string;
  /** Optional className applied to the root wrapper. */
  className?: string;
}

/**
 * Renders the list of currently-active coupons fetched from
 * /api/v1/coupons. Two visual variants (see `Props.variant`).
 *
 * Returns null while loading or when zero coupons are available — the
 * inline consumer (cart, checkout) simply doesn't render anything, which
 * matches the "no noise when nothing to show" intent.
 */
export function AvailableCoupons({
  variant = "inline",
  onApply,
  appliedCodes = [],
  title,
  className,
}: Props) {
  const isPage = variant === "page";
  const headerTitle = isPage
    ? "الرموز الترويجية"
    : title ?? "كوبونات متاحة";

  const [coupons, setCoupons] = useState<AvailableCouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/coupons")
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res.success) throw new Error(res.error || "fetch failed");
        setCoupons(res.coupons || []);
      })
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : "حصل خطأ")
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000);
    } catch {
      window.prompt("انسخ الكود", code);
    }
  };

  // Inline variant: silently no-op while loading or when there are no
  // coupons. Keeps the cart + checkout pages clean when the user has
  // nothing to apply.
  if (!isPage) {
    if (loading) return null;
    if (coupons.length === 0) return null;
    return (
      <div className={className ?? "mt-4"}>
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
          <TicketPercent className="w-4 h-4 text-primary" />
          {title}
        </h4>
        <ul className="space-y-2">
          {coupons.map((c) => {
            const applied = appliedCodes.includes(c.code);
            return (
              <li
                key={c.code}
                className="bg-gray-50 rounded-xl border border-gray-200 p-3 flex gap-2 items-center text-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">
                    {describeCoupon(c)}
                  </p>
                  <code
                    className="text-xs bg-white px-1.5 py-0.5 rounded font-mono inline-block mt-0.5"
                    dir="ltr"
                  >
                    {c.code}
                  </code>
                </div>

                {onApply && !applied && (
                  <button
                    type="button"
                    onClick={() => onApply(c.code)}
                    className="shrink-0 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary-700"
                  >
                    تطبيق
                  </button>
                )}
                {applied && (
                  <span className="shrink-0 text-xs text-primary font-medium">
                    مطبّق
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => copyCode(c.code)}
                  aria-label={`نسخ ${c.code}`}
                  className="shrink-0 p-1.5 hover:bg-gray-200 rounded"
                >
                  {copiedCode === c.code ? (
                    <Check className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Page variant — full layout. Preserves the profile-coupons visual.
  if (loading) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <p className="text-gray-500">جاري التحميل...</p>
      </main>
    );
  }

  return (
    <main className="min-h-[80vh] bg-gray-50">
      <div className={className ?? "max-w-2xl mx-auto px-4 py-6"}>
        <Link
          href="/profile"
          className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-4"
        >
          <ArrowRight className="w-4 h-4" />
          حسابي
        </Link>

        <PageHeader
          icon={<TicketPercent className="w-6 h-6 text-primary" />}
          title={headerTitle}
          subtitle="كل الكوبونات النشطة — استخدمها عند الطلب لكسب خصم أو توصيل مجاني."
          className="mb-6"
        />

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {coupons.length === 0 ? (
          <Card className="p-8 text-center">
            <TicketPercent className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h2 className="font-semibold text-gray-900 mb-1">
              ما عندنا عروض حالياً
            </h2>
            <p className="text-sm text-gray-500">
              تابعنا — رح نضيف كوبونات جديدة قريباً.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {coupons.map((c) => {
              const left = daysUntil(c.expires_at);
              return (
                <li
                  key={c.code}
                  className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3 items-center"
                >
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <TicketPercent className="w-6 h-6" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">
                      {describeCoupon(c)}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <code className="bg-gray-100 px-2 py-0.5 rounded font-mono" dir="ltr">
                        {c.code}
                      </code>
                      {left != null && (
                        <span>
                          {left === 0 ? "ينتهي اليوم" : `باقي ${left} يوم`}
                        </span>
                      )}
                      {c.max_uses != null && (
                        <span>
                          استُخدم {Number(c.used_count)} من {c.max_uses}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyCode(c.code)}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors"
                    aria-label={`نسخ الكود ${c.code}`}
                  >
                    {copiedCode === c.code ? (
                      <>
                        <Check className="w-4 h-4" />
                        تم النسخ
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        نسخ
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}