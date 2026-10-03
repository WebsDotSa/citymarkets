"use client";

// Providers tab — channel readiness + per-provider editable connection
// settings for the only runtime-mutable provider (WhatsApp admin alerts)
// and a status grid for the env-configured channels (Push / SMS / Email / SSE).
//
// The mutation surface is intentionally narrow: only the legacy
// whatsapp_admin_phone / notify_new_order / message_template fields are
// persisted. The other channels are configured via env vars, and we
// surface their required keys so admins can wire them up.

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  MessageCircle,
  Bell,
  Smartphone,
  Mail,
  Zap,
  Send,
  Eye,
  AlertCircle,
  Copy,
} from "lucide-react";
import { StatCard } from "@/components/admin/admin-header";
import { useToast } from "@/components/ui/toast";
import { broadcastApi } from "./api";
import { CHANNELS, type ProviderStatus } from "./types";

interface LegacySettings {
  whatsapp_admin_phone: string;
  notify_new_order: boolean;
  message_template: string;
}

const DEFAULT_TEMPLATE =
  "طلب جديد #{order_id} — {customer} — {total} ر.س — أسواق سيتي";

const TEMPLATE_VARS = [
  { key: "order_id", label: "رقم الطلب" },
  { key: "customer", label: "اسم العميل" },
  { key: "total", label: "الإجمالي" },
];

const CHANNEL_META: Record<
  string,
  { icon: typeof Bell; envLabel: string[]; help: string }
> = {
  web_push: {
    icon: Bell,
    envLabel: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    help: "متصفح الويب عبر VAPID — يُستخدم لإشعارات المتجر على الحاسوب.",
  },
  native_push: {
    icon: Smartphone,
    envLabel: [
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "APNS_BUNDLE_ID",
      "APNS_KEY_PATH",
    ],
    help: "إشعارات iOS / Android عبر APNs — يتطلب شهادة Apple Developer.",
  },
  sms: {
    icon: Smartphone,
    envLabel: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_MESSAGING_SERVICE_SID",
    ],
    help: "رسائل SMS عبر Twilio — يستخدم رقم هاتف العميل.",
  },
  email: {
    icon: Mail,
    envLabel: ["RESEND_API_KEY", "RESEND_FROM"],
    help: "البريد عبر Resend — يُستخدم لإشعارات الطلبات والحملات.",
  },
  in_app: {
    icon: Zap,
    envLabel: [],
    help: "قناة فورية داخل التطبيق عبر SSE — مفعّلة افتراضياً بدون إعدادات.",
  },
};

export function NotificationsProvidersTab() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacySettings>({
    whatsapp_admin_phone: "",
    notify_new_order: true,
    message_template: DEFAULT_TEMPLATE,
  });
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      broadcastApi.providerStatus().catch(() => [] as ProviderStatus[]),
      fetch("/api/admin/settings/notifications", { credentials: "include" })
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([ps, settings]) => {
      if (cancelled) return;
      setProviders(ps);
      if (settings?.success && settings.settings) {
        setLegacy({
          whatsapp_admin_phone: settings.settings.whatsapp_admin_phone || "",
          notify_new_order: settings.settings.notify_new_order !== false,
          message_template:
            settings.settings.message_template || DEFAULT_TEMPLATE,
        });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLegacy = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/notifications", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsapp_admin_phone: legacy.whatsapp_admin_phone,
          notify_new_order: legacy.notify_new_order,
          message_template: legacy.message_template,
        }),
      }).then((r) => r.json());
      if (res.success) {
        showToast("تم حفظ إعدادات الموفّر بنجاح", "success");
      } else {
        showToast(res.error || "فشل الحفظ", "error");
      }
    } catch {
      showToast("فشل الاتصال بالخادم", "error");
    } finally {
      setSaving(false);
    }
  };

  const previewLegacy = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/admin/settings/notifications", {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json());
      if (res.success && res.whatsapp_url) {
        setPreviewUrl(res.whatsapp_url);
        showToast("تم تجهيز المعاينة", "success");
      } else {
        showToast(res.error || "فشل إنشاء المعاينة", "error");
      }
    } catch {
      showToast("فشل الاتصال بالخادم", "error");
    } finally {
      setPreviewing(false);
    }
  };

  const insertVariable = (key: string) => {
    setLegacy((l) => ({ ...l, message_template: `${l.message_template} #{${key}}` }));
  };

  const copyEnv = (env: string) => {
    void navigator.clipboard.writeText(env);
    showToast("تم نسخ اسم المتغير", "success");
  };

  const summary = useMemo(() => {
    const total = providers.length || CHANNELS.length;
    const ready = providers.filter((p) => p.configured).length;
    return { total, ready };
  }, [providers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="الموفّرون المفعّلون"
          value={`${summary.ready} / ${summary.total}`}
          icon={<CheckCircle2 className="text-2xl text-white" />}
          variant="success"
        />
        <StatCard
          title="إشعارات الطلبات"
          value={legacy.notify_new_order ? "مفعّلة" : "معطّلة"}
          icon={<MessageCircle className="text-2xl text-white" />}
          variant={legacy.notify_new_order ? "primary" : "default"}
        />
        <StatCard
          title="رقم المدير"
          value={legacy.whatsapp_admin_phone || "غير مضبوط"}
          icon={<Smartphone className="text-2xl text-white" />}
          variant={legacy.whatsapp_admin_phone ? "info" : "warning"}
        />
      </div>

      {/* Channel status grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {CHANNELS.map((c) => {
          const p = providers.find((x) => x.channel === c.value);
          const configured = p?.configured ?? false;
          const Meta = CHANNEL_META[c.value];
          const Icon = Meta?.icon ?? Bell;
          return (
            <div
              key={c.value}
              className={`rounded-2xl border p-4 flex flex-col gap-2 transition-colors ${
                configured
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    configured
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                {configured ? (
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    يعمل
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold text-gray-500">
                    <XCircle className="w-3.5 h-3.5" />
                    يحتاج إعداد
                  </span>
                )}
              </div>
              <div>
                <p className="font-bold text-gray-800 text-sm">{c.label}</p>
                <p className="text-2xs text-gray-500 mt-0.5 line-clamp-2">
                  {Meta?.help ?? "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-channel detail list */}
      <div className="admin-card p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-1">حالة الموفّرين</h2>
        <p className="text-xs text-gray-500 mb-4">
          الموفّرون المهيّؤون عبر متغيرات البيئة (env) — يجب ضبطها في ملف
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 text-gray-700 text-2xs">.env.local</code>
          ثم إعادة تشغيل الخادم.
        </p>
        <div className="divide-y divide-gray-100">
          {CHANNELS.map((c) => {
            const p = providers.find((x) => x.channel === c.value);
            const configured = p?.configured ?? false;
            const envList = p?.env ?? [];
            const Icon = CHANNEL_META[c.value]?.icon ?? Bell;
            return (
              <div key={c.value} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-gray-50 text-gray-600 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">
                        {c.label}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {p?.detail ?? "—"}
                      </p>
                    </div>
                  </div>
                  {configured ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                      مفعّل
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-semibold flex-shrink-0">
                      <AlertCircle className="w-4 h-4" />
                      يحتاج إعداد
                    </span>
                  )}
                </div>
                {envList.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {envList.map((env) => (
                      <button
                        key={env}
                        type="button"
                        onClick={() => copyEnv(env)}
                        title="نسخ اسم المتغير"
                        className="inline-flex items-center gap-1 text-2xs font-mono px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        {env}
                        <Copy className="w-3 h-3 opacity-50" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* WhatsApp admin connection */}
      <div className="admin-card p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                ربط واتساب المدير
              </h2>
              <p className="text-xs text-gray-500">
                استقبل إشعارات الطلبات الجديدة على رقم الواتساب الخاص بالمدير.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
              legacy.whatsapp_admin_phone
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {legacy.whatsapp_admin_phone ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> مربوط
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5" /> غير مربوط
              </>
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <label className="block">
            <span className="text-sm text-gray-600">رقم واتساب المدير</span>
            <input
              type="tel"
              value={legacy.whatsapp_admin_phone}
              onChange={(e) =>
                setLegacy({ ...legacy, whatsapp_admin_phone: e.target.value })
              }
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="9665xxxxxxxx"
              dir="ltr"
            />
            <span className="text-2xs text-gray-400 mt-1 block">
              يبدأ برمز الدولة (مثال: 966 للسعودية)
            </span>
          </label>

          <label className="flex items-center gap-3 mt-7 sm:mt-8">
            <span className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={legacy.notify_new_order}
                onChange={(e) =>
                  setLegacy({ ...legacy, notify_new_order: e.target.checked })
                }
                className="sr-only peer"
              />
              <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:right-0.5 after:bg-white after:w-5 after:h-5 after:rounded-full after:transition-transform peer-checked:after:-translate-x-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-gray-800">
                تفعيل إشعار الطلبات الجديدة
              </p>
              <p className="text-xs text-gray-500">
                عند إيقافه لن يصل الموظف أي إشعار.
              </p>
            </div>
          </label>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">قالب الرسالة</span>
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  className="text-2xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700 hover:bg-primary/10 hover:text-primary transition-colors"
                  title={`إضافة {${v.key}} — ${v.label}`}
                >
                  {`#{${v.key}}`}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={legacy.message_template}
            onChange={(e) =>
              setLegacy({ ...legacy, message_template: e.target.value })
            }
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            dir="rtl"
          />
          <p className="text-2xs text-gray-400 mt-1">
            المتغيرات:{" "}
            <code className="font-mono">{"#{order_id}"}</code>,{" "}
            <code className="font-mono">{"#{customer}"}</code>,{" "}
            <code className="font-mono">{"#{total}"}</code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5">
          <button
            onClick={saveLegacy}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50 hover:bg-primary-dark transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {saving ? "جاري الحفظ…" : "حفظ الإعدادات"}
          </button>
          <button
            onClick={previewLegacy}
            disabled={previewing || !legacy.whatsapp_admin_phone}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            {previewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            معاينة الرابط
          </button>
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              فتح رابط واتساب التجريبي ←
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
