/**
 * Canonical client-side extraction of a human-readable error from an API
 * response body. Pure and client-safe.
 *
 * The server currently emits TWO error envelopes:
 *   - legacy:    `{ success: false, error: "رسالة" }`
 *   - canonical: `{ success: false, error: { code, messageAr, messageEn } }`
 *     (`@/lib/api-response` → `fail()`)
 *
 * Components used to hand-roll `data.error || "fallback"`, which renders
 * the canonical envelope as an object. Always go through this helper so a
 * route can move to the canonical envelope without breaking its clients.
 */
export type ApiErrorLang = "ar" | "en";

export function getApiErrorMessage(
  body: unknown,
  fallback: string,
  lang: ApiErrorLang = "ar",
): string {
  if (!body || typeof body !== "object") return fallback;
  const err = (body as { error?: unknown; message?: unknown }).error;

  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const e = err as { messageAr?: unknown; messageEn?: unknown; message?: unknown };
    const preferred = lang === "ar" ? e.messageAr : e.messageEn;
    for (const m of [preferred, e.messageAr, e.messageEn, e.message]) {
      if (typeof m === "string" && m.trim()) return m;
    }
  }
  const top = (body as { message?: unknown }).message;
  if (err === undefined && typeof top === "string" && top.trim()) return top;
  return fallback;
}

/** Machine-readable code from the canonical envelope, if present. */
export function getApiErrorCode(body: unknown): string | null {
  const err = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}
