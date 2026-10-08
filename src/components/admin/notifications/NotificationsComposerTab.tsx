"use client";

// Composer tab — create or edit a broadcast (rich content + audience +
// channels + schedule), with live per-channel previews.

import { useEffect, useMemo, useState } from "react";
import { Save, Send, Loader2, Mail, MessageCircle, Image as ImageIcon, Calendar } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { broadcastApi } from "./api";
import {
  CHANNELS,
  SEGMENT_OPTIONS,
  VARIABLE_OPTIONS,
  type Broadcast,
  type BroadcastChannel,
} from "./types";

interface DraftBroadcast {
  title: string;
  body: string;
  body_html: string;
  image_url: string;
  cta_label: string;
  cta_url: string;
  channels: BroadcastChannel[];
  audience: Broadcast["audience"];
  scheduled_at: string;
}

const EMPTY_DRAFT: DraftBroadcast = {
  title: "",
  body: "",
  body_html: "",
  image_url: "",
  cta_label: "",
  cta_url: "",
  channels: ["web_push"],
  audience: { type: "all" },
  scheduled_at: "",
};

export function NotificationsComposerTab({
  initial,
  onSaved,
}: {
  initial?: Broadcast;
  onSaved?: (b: Broadcast) => void;
}) {
  const [draft, setDraft] = useState<DraftBroadcast>(toDraft(initial));
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const setField = <K extends keyof DraftBroadcast>(key: K, value: DraftBroadcast[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleChannel = (c: BroadcastChannel) => {
    const next = draft.channels.includes(c)
      ? draft.channels.filter((x) => x !== c)
      : [...draft.channels, c];
    setField("channels", next);
  };

  const audienceQueryKey = useMemo(
    () => JSON.stringify({ audience: draft.audience, channels: draft.channels }),
    [draft.audience, draft.channels],
  );

  useEffect(() => {
    if (draft.channels.length === 0) {
      setAudienceCount(null);
      return;
    }
    let cancelled = false;
    setAudienceLoading(true);
    broadcastApi
      .audiencePreview(draft.audience, draft.channels)
      .then((r) => {
        if (!cancelled) setAudienceCount(r.count);
      })
      .catch(() => {
        if (!cancelled) setAudienceCount(null);
      })
      .finally(() => {
        if (!cancelled) setAudienceLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // audienceQueryKey captures the inputs that affect the preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceQueryKey]);

  const save = async (send: boolean) => {
    if (!draft.title.trim()) {
      showToast("عنوان البث مطلوب", "error");
      return;
    }
    if (!draft.body.trim()) {
      showToast("المحتوى مطلوب", "error");
      return;
    }
    if (draft.channels.length === 0) {
      showToast("اختر قناة واحدة على الأقل", "error");
      return;
    }
    if (draft.cta_label && !draft.cta_url) {
      showToast("رابط الزر مطلوب عند تعيين عنوانه", "error");
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Broadcast> = {
        title: draft.title,
        body: draft.body,
        body_html: draft.body_html || null,
        image_url: draft.image_url || null,
        cta_label: draft.cta_label || null,
        cta_url: draft.cta_url || null,
        channels: draft.channels,
        audience: draft.audience,
        scheduled_at: draft.scheduled_at ? new Date(draft.scheduled_at).toISOString() : null,
      };
      const saved = initial?.id
        ? await broadcastApi.updateBroadcast(initial.id, payload)
        : await broadcastApi.createBroadcast(payload);
      if (send) {
        await broadcastApi.sendBroadcast(saved.id);
        showToast("تم إرسال البث", "success");
      } else if (draft.scheduled_at) {
        // Server sees scheduled_at and flips status to "scheduled"; trigger send
        // endpoint accepts scheduled_at too, and worker picks it up.
        await broadcastApi.sendBroadcast(saved.id);
        showToast("تمت جدولة البث", "success");
      } else {
        showToast(initial?.id ? "تم الحفظ" : "تم إنشاء البث كمسودة", "success");
      }
      setDraft(toDraft(saved));
      onSaved?.(saved);
    } catch (err) {
      showToast((err as Error).message || "فشل الحفظ", "error");
    } finally {
      setSaving(false);
    }
  };

  const charCount = draft.body.length;
  const warningAt = 240; // push body limit
  const overLimit = charCount > warningAt;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Section title="محتوى البث" icon={<Mail className="w-4 h-4" />}>
          <Field label="عنوان البث" required>
            <input
              value={draft.title}
              onChange={(e) => setField("title", e.target.value)}
              maxLength={120}
              placeholder="مثال: خصومات نهاية الأسبوع"
              className="admin-input"
            />
            <span className="text-xs text-gray-400 mt-1 block">
              {draft.title.length}/120
            </span>
          </Field>

          <Field label="المحتوى" required>
            <textarea
              value={draft.body}
              onChange={(e) => setField("body", e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="نص الرسالة. المتغيرات مثل {customer_name} تُستبدل تلقائياً."
              className={`admin-input resize-y ${overLimit ? "border-amber-400" : ""}`}
            />
            <div className="flex justify-between text-xs mt-1">
              <span className={overLimit ? "text-amber-600" : "text-gray-400"}>
                {charCount}/1000
                {overLimit && " · يُفضل اختصار النص للإشعارات الفورية"}
              </span>
              <span className="text-gray-400">المتغيرات: {VARIABLE_OPTIONS.length}</span>
            </div>
          </Field>

          <Field label="محتوى HTML (لـ Email)" hint="اختياري. يستخدم فقط عند اختيار قناة Email.">
            <textarea
              value={draft.body_html}
              onChange={(e) => setField("body_html", e.target.value)}
              rows={5}
              placeholder="<h1>...</h1>"
              className="admin-input font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="رابط الصورة" hint="اختياري">
              <div className="relative">
                <ImageIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={draft.image_url}
                  onChange={(e) => setField("image_url", e.target.value)}
                  placeholder="https://cdn.citymarkets.sa/banner.jpg"
                  className="admin-input pr-9"
                />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="زر · عنوان">
                <input
                  value={draft.cta_label}
                  onChange={(e) => setField("cta_label", e.target.value)}
                  maxLength={40}
                  placeholder="تسوّق الآن"
                  className="admin-input"
                />
              </Field>
              <Field label="زر · رابط">
                <input
                  value={draft.cta_url}
                  onChange={(e) => setField("cta_url", e.target.value)}
                  placeholder="https://citymarkets.sa/offers"
                  className="admin-input"
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="القنوات" icon={<MessageCircle className="w-4 h-4" />}>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const active = draft.channels.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleChannel(c.value)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors inline-flex items-center gap-2 ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:border-primary"
                  }`}
                >
                  <span aria-hidden>{c.icon}</span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="الجمهور المستهدف" icon={<MessageCircle className="w-4 h-4" />}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {SEGMENT_OPTIONS.map((seg) => {
                const active =
                  draft.audience.type === "segment" && draft.audience.segment === seg.value;
                return (
                  <button
                    key={seg.value}
                    type="button"
                    onClick={() =>
                      setField("audience", { type: "segment", segment: seg.value })
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-gray-700 border-gray-200 hover:border-primary"
                    }`}
                  >
                    {seg.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setField("audience", { type: "all" })}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  draft.audience.type === "all"
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-primary"
                }`}
              >
                الكل
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">المستهدفون:</span>
              <span className="font-medium text-gray-800">
                {audienceLoading ? (
                  <Loader2 className="w-4 h-4 inline animate-spin" />
                ) : audienceCount === null ? (
                  "—"
                ) : (
                  audienceCount.toLocaleString("ar-SA")
                )}
              </span>
              <span className="text-gray-400">مستخدم</span>
            </div>
          </div>
        </Section>

        <Section title="الجدولة" icon={<Calendar className="w-4 h-4" />}>
          <Field label="وقت الإرسال" hint="اتركه فارغاً للإرسال الفوري عند الضغط على 'إرسال'.">
            <input
              type="datetime-local"
              value={draft.scheduled_at}
              onChange={(e) => setField("scheduled_at", e.target.value)}
              className="admin-input"
            />
          </Field>
        </Section>
      </div>

      <div className="space-y-4">
        <div className="admin-card p-5 space-y-3">
          <h3 className="font-bold text-gray-800">القنوات المختارة</h3>
          {draft.channels.length === 0 ? (
            <p className="text-sm text-gray-500">اختر قناة واحدة على الأقل.</p>
          ) : (
            draft.channels.map((c) => (
              <ChannelPreview
                key={c}
                channel={c}
                title={draft.title}
                body={draft.body}
                ctaLabel={draft.cta_label}
              />
            ))
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="admin-btn-primary justify-center"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ كمسودة
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="admin-btn admin-btn-primary justify-center bg-primary"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {draft.scheduled_at ? "جدولة" : "إرسال الآن"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-gray-800">
        <span className="text-primary">{icon}</span>
        <h3 className="font-bold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">
        {label}
        {required && <span className="text-red-500 ms-1">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-gray-400 mt-1 block">{hint}</span>}
    </label>
  );
}

function ChannelPreview({
  channel,
  title,
  body,
  ctaLabel,
}: {
  channel: BroadcastChannel;
  title: string;
  body: string;
  ctaLabel: string;
}) {
  const meta = CHANNELS.find((c) => c.value === channel);
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
        <span>{meta?.icon}</span>
        <span>{meta?.label}</span>
      </div>
      {channel === "email" ? (
        <div className="bg-white rounded-md p-3 text-xs">
          <p className="font-semibold text-gray-800">{title || "(بدون عنوان)"}</p>
          <p className="text-gray-600 mt-1 whitespace-pre-wrap">{body || "(بدون محتوى)"}</p>
          {ctaLabel && (
            <span className="inline-block mt-2 px-3 py-1 rounded-md bg-primary text-white text-2xs">
              {ctaLabel}
            </span>
          )}
        </div>
      ) : channel === "sms" ? (
        <div className="bg-white rounded-md p-3 text-xs max-w-[220px]">
          <p className="text-gray-800 whitespace-pre-wrap">{body || "(بدون محتوى)"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-md p-3 shadow-sm">
          <p className="text-xs font-semibold text-gray-800">
            {title || "(بدون عنوان)"}
          </p>
          <p className="text-2xs text-gray-600 mt-1 line-clamp-3">
            {body || "(بدون محتوى)"}
          </p>
          {ctaLabel && (
            <p className="mt-2 text-tiny text-primary underline">{ctaLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}

function toDraft(b?: Broadcast): DraftBroadcast {
  if (!b) return EMPTY_DRAFT;
  const local = b.scheduled_at ? toLocalInput(b.scheduled_at) : "";
  return {
    title: b.title ?? "",
    body: b.body ?? "",
    body_html: b.body_html ?? "",
    image_url: b.image_url ?? "",
    cta_label: b.cta_label ?? "",
    cta_url: b.cta_url ?? "",
    channels: b.channels ?? ["web_push"],
    audience: b.audience ?? { type: "all" },
    scheduled_at: local,
  };
}

function toLocalInput(iso: string): string {
  // Convert ISO datetime to `YYYY-MM-DDTHH:mm` for <input type="datetime-local" />.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
