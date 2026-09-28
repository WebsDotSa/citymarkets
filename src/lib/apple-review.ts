/**
 * Apple App Store Review account — server-only helpers.
 *
 * When `APPLE_REVIEW_ENABLED=true`:
 *   - `/api/v1/auth/twilio/send` returns a synthetic Verification object
 *     (does NOT call Twilio, skips the per-phone + per-IP rate limit).
 *   - `/api/v1/auth/twilio/verify` accepts the configured OTP without
 *     calling Twilio, also skips the rate limit, and ensures the user
 *     row exists with `name=APPLE_REVIEW_NAME` so the iOS client renders
 *     a logged-in session (not the "Continue as guest" prompt).
 *
 * SECURITY:
 * - The phone and OTP are checked ONLY here. The iOS client must NOT
 *   hard-code these values — they're read at request time so any reverse-
 *   engineering of the binary reveals nothing useful.
 * - Rate limits are skipped only for this phone. Real customers on the
 *   same IP are still capped by the per-IP bucket (other endpoints).
 * - The "Apple Reviewer" name is a sentinel: any backend code that
 *   persists real customer data (orders, addresses, payments) MUST
 *   either reject writes from this user or sandbox them. Use
 *   `isAppleReviewUser(user)` as a guard.
 *
 * The phone MUST be in Twilio E.164 format. Saudi local 0555555555 →
 * +966555555555 (drop leading 0, prepend country code).
 *
 * Env reads are centralized in `@/lib/env` so the rest of the codebase
 * has one canonical place to look up secrets. The re-exported constants
 * below preserve the public API for older callers.
 */

import {
  getAppleReviewName as _getAppleReviewName,
  getAppleReviewOtp as _getAppleReviewOtp,
  getAppleReviewPhone as _getAppleReviewPhone,
  isAppleReviewEnabled as _isAppleReviewEnabled,
} from "@/lib/env";

export const APPLE_REVIEW_ENABLED = _isAppleReviewEnabled();

export const APPLE_REVIEW_PHONE_E164 = _getAppleReviewPhone();

export const APPLE_REVIEW_OTP = _getAppleReviewOtp();

export const APPLE_REVIEW_NAME = _getAppleReviewName();

/**
 * Returns true when the env is fully configured AND the e164 phone
 * matches `APPLE_REVIEW_PHONE`. The phone must be normalized through
 * `normalizeSaudiToE164` BEFORE calling this (the auth route already does).
 */
export function isAppleReviewPhone(e164: string | null | undefined): boolean {
  if (!APPLE_REVIEW_ENABLED) return false;
  if (!APPLE_REVIEW_PHONE_E164 || !APPLE_REVIEW_OTP) return false;
  if (!e164) return false;
  return e164 === APPLE_REVIEW_PHONE_E164;
}

/**
 * Sentinel check for backend code that needs to skip the Apple review
 * account (e.g. real order processing, analytics, loyalty rewards).
 *
 * Usage:
 *   if (isAppleReviewUser(user)) {
 *     // skip — don't write real customer data
 *     return;
 *   }
 */
export function isAppleReviewUser(user: { name?: string | null; phone?: string | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.name === APPLE_REVIEW_NAME) return true;
  if (user.phone && APPLE_REVIEW_PHONE_E164 && user.phone === APPLE_REVIEW_PHONE_E164) return true;
  return false;
}
