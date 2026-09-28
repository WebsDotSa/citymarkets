/**
 * /direct-order → /orders/direct permanent redirect.
 *
 * The Quick Order FAB and QA smoke test still reference `/direct-order`,
 * but the page itself was relocated under `/orders/direct/` during the
 * orders-section refactor (mirrors the layout of `/orders`, `/orders/[id]`,
 * `/orders/track`, etc.). Without this redirect any legacy link, social
 * share, or external index that points at `/direct-order` returns 404.
 *
 * Server-rendered 308 (Permanent Redirect) so:
 *   - Search engines transfer any existing ranking signals to the
 *     canonical URL.
 *   - Curl / fetch / iOS WebKit follow it on the first hop without
 *     needing JS.
 *   - The customer guard in `proxy.ts` continues to gate `/orders/direct`
 *     correctly — `/redirect never returns a body, so the guard never
 *     sees an authenticated request.
 */
import { permanentRedirect } from "next/navigation";

export default function DirectOrderRedirect() {
  permanentRedirect("/orders/direct");
}