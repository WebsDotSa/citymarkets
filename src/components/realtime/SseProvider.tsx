"use client";

// SSE client — opens /api/v1/events/stream, dispatches broadcast
// events to the toast layer, and acks opens so metrics reflect the
// real reach. Mounted once inside <Providers> (see contexts/providers.tsx).
//
// The connection is authenticated by the same cookie/Bearer header
// as the rest of /api/v1, so no manual token handling is needed.
// If the user logs out, the stream simply 401s and we stop.

import { useEffect, useRef } from "react";
import { useAuthState } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";

interface BroadcastPayload {
  title?: string;
  body?: string;
  url?: string | null;
  broadcast_id?: string;
  delivery_id?: string;
  image_url?: string | null;
}

function postAck(deliveryId: string, state: "delivered" | "opened" = "delivered") {
  // Fire and forget — failures must not surface to the user, they
  // would just inflate the undelivered count on the next broadcast.
  fetch("/api/v1/events/ack", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delivery_id: deliveryId, state }),
    keepalive: true,
  }).catch(() => undefined);
}

export function SseProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthState();
  const { showToast } = useToast();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!user?.user) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    if (esRef.current) return; // already open

    const es = new EventSource("/api/v1/events/stream", { withCredentials: true });
    esRef.current = es;

    const onBroadcast = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as BroadcastPayload;
        const text = [data.title, data.body].filter(Boolean).join(" — ");
        if (text) showToast(text, "info");
        if (data.delivery_id) postAck(data.delivery_id, "delivered");
      } catch {
        // ignore malformed payload
      }
    };
    es.addEventListener("broadcast", onBroadcast as EventListener);
    es.onerror = () => {
      // EventSource auto-reconnects; we just log via a console-free path.
    };
    return () => {
      es.removeEventListener("broadcast", onBroadcast as EventListener);
      es.close();
      esRef.current = null;
    };
  }, [user?.user, showToast]);

  return <>{children}</>;
}
