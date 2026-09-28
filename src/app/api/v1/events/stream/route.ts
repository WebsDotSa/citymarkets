// SSE stream — per-user. Customer receives broadcast events (and any
// future per-user server-pushed events) over a single long-lived
// connection authenticated by the same `customer_session` cookie /
// Bearer header as the rest of /api/v1.
//
// 15s heartbeat keeps proxies (and iOS in-app webviews) from
// dropping the connection.
//
// Single-instance only (memory-backed pub/sub in `@/lib/sse`).
// Multi-instance deployments would need Redis pub/sub behind the
// same interface — out of scope today (see plan).

import { NextRequest } from "next/server";
import { resolveCustomerUserIdFromRequest } from "@/lib/customer-session";
import { subscribe, heartbeatComment, type SseEvent } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

export async function GET(request: NextRequest): Promise<Response> {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial comment so the client knows the stream is open before
      // any event arrives (avoids the browser holding the connection
      // in "loading" state on slow first bytes).
      controller.enqueue(new TextEncoder().encode(`: connected\n\n`));

      unsub = subscribe(userId, controller);
      heartbeat = setInterval(() => heartbeatComment(controller), HEARTBEAT_MS);

      const onAbort = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsub?.();
        unsub = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsub?.();
      unsub = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export type BroadcastSseEvent = SseEvent;
