/**
 * Broadcast notification center + realtime events.
 *
 * Used by:
 *   - /api/admin/broadcasts (create / update / send broadcasts)
 *   - /api/admin/broadcast-templates (CRUD on templates)
 *   - /api/v1/events/ack (mobile client clears pending event queue)
 *
 * Channels are restricted to the 5 supported send channels.
 * Audience is JSONB (validated here as a typed object) so future
 * segment additions don't require a migration.
 */

import { z } from "zod";

export const BROADCAST_CHANNELS = [
  "web_push",
  "native_push",
  "sms",
  "email",
  "in_app",
] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

const SEGMENT_VALUES = [
  "all",
  "with_push",
  "with_native_push",
  "with_phone",
  "with_email",
  "top_loyalty",
  "ordered_last_30d",
  "inactive_30d",
] as const;
const LOYALTY_TIER_VALUES = ["bronze", "silver", "gold", "platinum"] as const;

export const audienceFilterSchema = z
  .object({
    type: z.enum(["all", "segment"]),
    segment: z.enum(SEGMENT_VALUES).optional(),
    loyalty_min: z.number().int().min(0).max(1_000_000).optional(),
    loyalty_tier: z.enum(LOYALTY_TIER_VALUES).optional(),
    city: z.string().trim().max(80).optional(),
    exclude_user_ids: z.array(z.string().uuid()).max(50_000).optional(),
  })
  .strict();

const broadcastBase = {
  title: z.string().trim().min(1, "العنوان مطلوب").max(120),
  body: z.string().trim().min(1, "المحتوى مطلوب").max(1000),
  body_html: z.string().max(50_000).nullable().optional(),
  image_url: z.string().url().max(500).nullable().optional(),
  cta_label: z.string().trim().max(40).nullable().optional(),
  cta_url: z.string().url().max(500).nullable().optional(),
  channels: z
    .array(z.enum(BROADCAST_CHANNELS))
    .min(1, "اختر قناة واحدة على الأقل")
    .max(5),
  audience: audienceFilterSchema,
  template_id: z.string().uuid().nullable().optional(),
};

export const broadcastCreateSchema = z
  .object({
    ...broadcastBase,
    scheduled_at: z.string().datetime().nullable().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.cta_label && !b.cta_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "رابط الزر مطلوب",
        path: ["cta_url"],
      });
    }
    if (b.scheduled_at && Date.parse(b.scheduled_at) < Date.now() - 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "وقت الجدولة في الماضي",
        path: ["scheduled_at"],
      });
    }
  });

export const broadcastUpdateSchema = z
  .object({
    title: broadcastBase.title.optional(),
    body: broadcastBase.body.optional(),
    body_html: broadcastBase.body_html,
    image_url: broadcastBase.image_url,
    cta_label: broadcastBase.cta_label,
    cta_url: broadcastBase.cta_url,
    channels: broadcastBase.channels.optional(),
    audience: audienceFilterSchema.optional(),
    template_id: broadcastBase.template_id,
    scheduled_at: z.string().datetime().nullable().optional(),
  })
  .strict();

const templateChannelContentSchema = z.object({
  web_push: z
    .object({
      title: z.string().trim().max(80),
      body: z.string().trim().max(200),
    })
    .optional(),
  native_push: z
    .object({
      title: z.string().trim().max(80),
      body: z.string().trim().max(200),
    })
    .optional(),
  sms: z.object({ body: z.string().trim().max(1600) }).optional(),
  email: z
    .object({
      subject: z.string().trim().max(200),
      html: z.string().max(50_000),
    })
    .optional(),
  in_app: z
    .object({
      title: z.string().trim().max(120),
      body: z.string().trim().max(500),
      url: z.string().trim().max(500).optional(),
    })
    .optional(),
});

export const broadcastTemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1, "اسم القالب مطلوب").max(120),
    description: z.string().trim().max(500).nullable().optional(),
    category: z
      .enum(["promo", "order", "loyalty", "blog", "system"])
      .nullable()
      .optional(),
    channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1).max(5),
    content: templateChannelContentSchema,
    variables: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/i))
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const ch of b.channels) {
      if (!b.content[ch]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `محتوى القناة ${ch} مفقود`,
          path: ["content", ch],
        });
      }
    }
  });

// Update schema — every field optional, but still strict (rejects
// unknown keys). Defined as its own object since ZodEffects from
// `superRefine` does not expose `.partial()`.
export const broadcastTemplateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    category: z
      .enum(["promo", "order", "loyalty", "blog", "system"])
      .nullable()
      .optional(),
    channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1).max(5).optional(),
    content: templateChannelContentSchema.optional(),
    variables: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/i))
      .max(20)
      .optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

/**
 * Realtime events ACK (mobile clients clear pending event queue).
 * "delivered" = first client-side confirmation (e.g. SSE message
 * received, push shown). "opened" = explicit user action (click).
 */
export const eventsAckSchema = z.object({
  delivery_id: z.string().uuid(),
  state: z.enum(["delivered", "opened"]).default("opened"),
});