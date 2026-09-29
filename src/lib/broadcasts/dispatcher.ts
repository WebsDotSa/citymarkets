// Per-delivery dispatcher. Branches by channel and records the outcome
// on `broadcast_deliveries`. Failures are non-fatal — one bad recipient
// never aborts the broadcast (mirrors `sendOrderConfirmationSms`).

import { pool } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { sendNativePushToUser } from "@/lib/native-push";
import { twilioSendSms } from "@/lib/twilio-messaging";
import { sendEmail } from "@/lib/email";
import { publishToUser } from "@/lib/sse";
import { interpolate, resolveTemplateContent, type InterpolationContext } from "./interpolate";
import { signDeliveryToken } from "./sign";
import { getSiteUrl } from "@/lib/seo/site";
import { error as logError } from "@/lib/logger";
import type { BroadcastChannel } from "@/lib/validation";

export interface DeliveryRow {
  id: string;
  broadcast_id: string;
  user_id: string;
  channel: BroadcastChannel;
}

interface BroadcastRow {
  id: string;
  title: string;
  body: string;
  body_html: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  template_id: string | null;
  channels: BroadcastChannel[];
}

interface TemplateRow {
  content: Record<string, unknown>;
}

interface UserRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  loyalty_points: number | null;
  loyalty_tier: string | null;
}

async function loadBroadcast(id: string): Promise<BroadcastRow | null> {
  const r = await pool.query(
    `SELECT id, title, body, body_html, image_url, cta_label, cta_url,
            template_id, channels
       FROM broadcasts WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function loadTemplate(id: string | null): Promise<TemplateRow | null> {
  if (!id) return null;
  const r = await pool.query(
    `SELECT content FROM broadcast_templates WHERE id = $1 AND is_active = TRUE`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function loadUser(id: string): Promise<UserRow | null> {
  const r = await pool.query(
    `SELECT id, name, phone, email, loyalty_points, loyalty_tier FROM users WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function recordOutcome(
  delivery: DeliveryRow,
  result:
    | { ok: true; externalId?: string | null }
    | { ok: false; error: string },
  extras: { delivered_at?: Date; opened_at?: Date; clicked_at?: Date } = {},
): Promise<void> {
  if (result.ok) {
    await pool.query(
      `UPDATE broadcast_deliveries
          SET status='sent', external_id=$2, sent_at=NOW(),
              delivered_at=COALESCE(delivered_at, $3::timestamptz),
              opened_at=COALESCE(opened_at, $4::timestamptz),
              clicked_at=COALESCE(clicked_at, $5::timestamptz),
              attempts = attempts + 1
        WHERE id=$1`,
      [
        delivery.id,
        result.externalId ?? null,
        extras.delivered_at ?? null,
        extras.opened_at ?? null,
        extras.clicked_at ?? null,
      ],
    );
  } else {
    await pool.query(
      `UPDATE broadcast_deliveries
          SET status='failed', error_message=$2, attempts = attempts + 1
        WHERE id=$1`,
      [delivery.id, result.error.slice(0, 500)],
    );
  }
}

async function markSkipped(delivery: DeliveryRow, reason: string): Promise<void> {
  await pool.query(
    `UPDATE broadcast_deliveries
        SET status='skipped', error_message=$2, attempts = attempts + 1
      WHERE id=$1`,
    [delivery.id, reason],
  );
}

export async function dispatchOne(d: DeliveryRow): Promise<void> {
  const broadcast = await loadBroadcast(d.broadcast_id);
  if (!broadcast) {
    await markSkipped(d, "broadcast_missing");
    return;
  }
  const user = await loadUser(d.user_id);
  if (!user) {
    await markSkipped(d, "user_missing");
    return;
  }
  const template = await loadTemplate(broadcast.template_id);
  const ctx: InterpolationContext = {
    user,
    broadcast: {
      title: broadcast.title,
      body: broadcast.body,
      body_html: broadcast.body_html,
      image_url: broadcast.image_url,
      cta_label: broadcast.cta_label,
      cta_url: broadcast.cta_url,
    },
  };

  // Template-resolved content (when template present), otherwise raw fields.
  const resolved = template ? resolveTemplateContent(template.content, ctx) : null;
  const title = resolved?.web_push?.title ?? interpolate(broadcast.title, ctx);
  const body = resolved?.web_push?.body ?? interpolate(broadcast.body, ctx);

  try {
    switch (d.channel) {
      case "web_push": {
        const r = await sendPushToUser(d.user_id, {
          title,
          body,
          url: broadcast.cta_url ?? undefined,
        });
        if (r.sent === 0 && r.failed === 0) {
          await markSkipped(d, "vapid_not_configured");
        } else if (r.sent === 0) {
          await recordOutcome(d, { ok: false, error: "all_pushes_failed" });
        } else {
          await recordOutcome(d, { ok: true });
        }
        return;
      }
      case "native_push": {
        const r = await sendNativePushToUser(d.user_id, { title, body });
        if (r.skipped) {
          // The reason field on the result distinguishes the three
          // skip paths so an admin can tell in the broadcast metrics
          // panel whether env vars are missing vs the user has no
          // registered device vs the concrete sender hasn't shipped
          // yet. Older callers that only set `skipped: true` still
          // get the historical `native_push_not_configured` reason.
          const reason =
            r.reason === "no_tokens"
              ? "native_push_no_tokens"
              : r.reason === "sender_not_implemented"
                ? "native_push_sender_pending"
                : "native_push_not_configured";
          await markSkipped(d, reason);
        } else {
          await recordOutcome(d, { ok: r.failed === 0, error: r.failed > 0 ? "send_failed" : "" });
        }
        return;
      }
      case "sms": {
        if (!user.phone) {
          await markSkipped(d, "no_phone");
          return;
        }
        const smsBody = resolved?.sms?.body ?? body;
        const r = await twilioSendSms(user.phone, smsBody);
        if (r.ok) {
          await recordOutcome(d, { ok: true, externalId: r.sid });
        } else {
          await recordOutcome(d, { ok: false, error: r.error });
        }
        return;
      }
      case "email": {
        if (!user.email) {
          await markSkipped(d, "no_email");
          return;
        }
        const subject = resolved?.email?.subject ?? title;
        const openToken = signDeliveryToken(d.id);
        const openUrl = `${getSiteUrl()}/api/v1/track/open?d=${encodeURIComponent(openToken)}`;
        const clickUrl = (url: string) =>
          `${getSiteUrl()}/api/v1/track/click?d=${encodeURIComponent(openToken)}&url=${encodeURIComponent(url)}`;
        const html =
          resolved?.email?.html ??
          `<!doctype html><html dir="rtl"><body><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(body)}</p>${
            broadcast.cta_url && broadcast.cta_label
              ? `<p><a href="${escapeAttr(clickUrl(broadcast.cta_url))}">${escapeHtml(broadcast.cta_label)}</a></p>`
              : ""
          }${
            broadcast.image_url
              ? `<img src="${escapeAttr(broadcast.image_url)}" alt="" style="max-width:560px" />`
              : ""
          }<img src="${escapeAttr(openUrl)}" alt="" width="1" height="1" style="display:none" /></body></html>`;
        const r = await sendEmail({
          to: user.email,
          subject,
          html,
          text: body,
          tags: [
            { name: "broadcast_id", value: d.broadcast_id },
            { name: "delivery_id", value: d.id },
          ],
        });
        if (r.ok) {
          await recordOutcome(d, { ok: true, externalId: r.id });
        } else {
          await recordOutcome(d, { ok: false, error: r.error });
        }
        return;
      }
      case "in_app": {
        publishToUser(d.user_id, {
          type: "broadcast",
          data: {
            title: resolved?.in_app?.title ?? title,
            body: resolved?.in_app?.body ?? body,
            url: resolved?.in_app?.url ?? broadcast.cta_url ?? null,
            broadcast_id: d.broadcast_id,
            delivery_id: d.id,
            image_url: broadcast.image_url,
          },
        });
        await recordOutcome(d, { ok: true });
        return;
      }
      default:
        await markSkipped(d, "unknown_channel");
    }
  } catch (err) {
    logError("[dispatcher] unhandled", err, { deliveryId: d.id });
    await recordOutcome(d, { ok: false, error: "unhandled_exception" });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "%22").replace(/</g, "%3C");
}