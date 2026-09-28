/**
 * Best-effort client IP extraction for rate limiting and audit logging.
 *
 * Trusts the first hop of `x-forwarded-for` (set by the load balancer in
 * front of the app), then falls back to `x-real-ip`. Missing headers
 * collapse to the literal "unknown" so that one shared bucket absorbs
 * IP-less traffic rather than silently bypassing the limiter.
 *
 * NOTE: This helper does NOT validate that the request came from a
 * trusted proxy. In production the app must run behind a proxy that
 * strips/overwrites the inbound `x-forwarded-for`; otherwise clients
 * could spoof their identifier to dodge the per-IP limit.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
