/**
 * `/api/v1/push/apns-register` — register / unregister a native push
 * device token (APNs for iOS, FCM for Android).
 *
 * Distinct from `/api/v1/push/subscribe` which is the Web-Push (VAPID)
 * path for the browser PWA. Native shells call this endpoint during
 * `application:didRegisterForRemoteNotificationsWithDeviceToken:`
 * (iOS) or `FirebaseMessaging.getToken()` (Android) and again whenever
 * the token rotates.
 *
 * Body shape:
 *   { platform: 'apns' | 'fcm', deviceToken: string, environment?: 'production' | 'sandbox', bundleId?: string, locale?: string }
 *
 * Auth: Bearer JWT (preferred for native) OR customer_session cookie.
 * The user id is derived from the verified token — never trusted from
 * the request body.
 */
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getCustomerUserIdFromRequest } from '@/lib/identity';
import { applyCsrfProtection } from "@/lib/csrf";
import {
  ok,
  badRequest,
  unauthorized,
  validationError,
  internalError,
  getRequestId,
} from "@/lib/api-response";
import { withCors } from "@/lib/cors";
import { info as logInfo, error as logError } from "@/lib/logger";
import { apnsRegisterSchema as RegisterSchema, apnsUnregisterSchema as UnregisterSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const handler = async (request: NextRequest) => {
  // Bearer tokens bypass CSRF (see lib/csrf.ts#validateCsrfRequest),
  // but cookie-authenticated users still need it — keep the gate.
  const csrf = await applyCsrfProtection(request);
  if (csrf) return csrf;

  const userId = await getCustomerUserIdFromRequest(request);
  if (!userId) return unauthorized();

  // DELETE = unregister, POST = register. Methods differ from
  // REST convention here because the existing /push/subscribe uses
  // POST-with-action pattern; mirror its surface for consistency.
  if (request.method === "DELETE") {
    return handleUnregister(request, userId);
  }
  return handleRegister(request, userId);
};

async function handleRegister(request: NextRequest, userId: string) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest({ ar: "JSON غير صالح", en: "Invalid JSON body" });
  }

  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError({
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
      requestId: getRequestId(request),
    });
  }

  const { platform, deviceToken, environment, bundleId, locale } = parsed.data;

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO native_push_tokens
           (platform, device_token, environment, bundle_id, locale, user_id, last_used)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (platform, device_token) DO UPDATE
           SET user_id    = EXCLUDED.user_id,
               environment = COALESCE(EXCLUDED.environment, native_push_tokens.environment),
               bundle_id  = COALESCE(EXCLUDED.bundle_id, native_push_tokens.bundle_id),
               locale     = COALESCE(EXCLUDED.locale, native_push_tokens.locale),
               last_used  = NOW()`,
        [platform, deviceToken, environment ?? null, bundleId ?? null, locale ?? null, userId]
      );
    } finally {
      client.release();
    }

    logInfo("[push] native token registered", {
      platform,
      userId,
      bundleId,
      locale,
      requestId: getRequestId(request),
    });

    return ok({
      registered: true,
      platform,
      bundleId: bundleId ?? null,
    });
  } catch (err) {
    logError("[push] apns-register failed", err, { requestId: getRequestId(request) });
    return internalError();
  }
}

async function handleUnregister(request: NextRequest, userId: string) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest({ ar: "JSON غير صالح", en: "Invalid JSON body" });
  }

  const parsed = UnregisterSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError({
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const client = await pool.connect();
    try {
      // SECURITY: only delete rows owned by the authenticated user.
      // Do NOT honor a user_id from the request body.
      await client.query(
        `DELETE FROM native_push_tokens
          WHERE platform = $1 AND device_token = $2 AND user_id = $3`,
        [parsed.data.platform, parsed.data.deviceToken, userId]
      );
    } finally {
      client.release();
    }
    return ok({ unregistered: true, platform: parsed.data.platform });
  } catch (err) {
    logError("[push] apns-unregister failed", err);
    return internalError();
  }
}

export const POST = withCors(handler);
export const DELETE = withCors(handler);
