// Shared types + constants for the admin Broadcast Center UI.
//
// These mirror the server-side Zod schemas in `src/lib/validation.ts`.
// Keep this in sync if the server schemas change.

import type { BroadcastChannel } from "@/lib/validation";

export type { BroadcastChannel };

export const CHANNELS: { value: BroadcastChannel; label: string; icon: string }[] = [
  { value: "web_push", label: "Push App", icon: "🔔" },
  { value: "native_push", label: "Push الجوال", icon: "📱" },
  { value: "sms", label: "SMS", icon: "✉️" },
  { value: "email", label: "Email Pro", icon: "📧" },
  { value: "in_app", label: "بروتوكول مباشر", icon: "⚡" },
];

export const SEGMENT_OPTIONS: {
  value:
    | "all"
    | "with_push"
    | "with_native_push"
    | "with_phone"
    | "with_email"
    | "top_loyalty"
    | "ordered_last_30d"
    | "inactive_30d";
  label: string;
}[] = [
  { value: "all", label: "جميع المستخدمين" },
  { value: "with_push", label: "المشتركون في Push App" },
  { value: "with_native_push", label: "المسجلون في Push الجوال" },
  { value: "with_phone", label: "لديهم رقم هاتف" },
  { value: "with_email", label: "لديهم بريد إلكتروني" },
  { value: "top_loyalty", label: "أعلى 10% ولاءً" },
  { value: "ordered_last_30d", label: "طلبوا خلال 30 يوم" },
  { value: "inactive_30d", label: "خاملون منذ 30 يوم" },
];

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  body_html: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  channels: BroadcastChannel[];
  audience: {
    type: "all" | "segment";
    segment?: string;
    loyalty_min?: number;
    loyalty_tier?: string;
    city?: string;
    exclude_user_ids?: string[];
  };
  template_id: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  stats?: Record<string, unknown>;
}

export interface BroadcastTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  channels: BroadcastChannel[];
  content: Record<string, unknown>;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderStatus {
  channel: BroadcastChannel;
  label: string;
  configured: boolean;
  detail?: string;
  /** Env-var keys required for this channel (not part of the legacy type, populated by `/api/admin/broadcast-providers/status`). */
  env?: string[];
}

export interface BroadcastMetrics {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  skipped: number;
  by_channel: Record<string, { sent: number; failed: number; skipped: number }>;
  open_rate: number; // 0..1
  click_rate: number; // 0..1
}

export const STATUS_LABEL: Record<Broadcast["status"], string> = {
  draft: "مسودة",
  scheduled: "مجدول",
  sending: "قيد الإرسال",
  sent: "تم الإرسال",
  cancelled: "ملغي",
  failed: "فشل",
};

export const STATUS_VARIANT: Record<Broadcast["status"], string> = {
  draft: "default",
  scheduled: "info",
  sending: "warning",
  sent: "success",
  cancelled: "default",
  failed: "danger",
};

export const VARIABLE_OPTIONS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "loyalty_points",
  "loyalty_tier",
  "broadcast_title",
];
