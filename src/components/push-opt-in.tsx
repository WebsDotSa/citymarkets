"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensurePermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

export async function subscribeToPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set; cannot subscribe.");
    return false;
  }
  const perm = await ensurePermission();
  if (perm !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }
  const json = sub.toJSON();
  const res = await fetch("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  return res.ok;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch(`/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
  });
  return true;
}

export function PushOptIn() {
  const [state, setState] = useState<"unknown" | "granted" | "denied" | "unsubscribed">("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setState("denied");
      return;
    }
    setState(Notification.permission as any);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (state === "granted") {
        await unsubscribeFromPush();
        setState("unsubscribed");
      } else {
        const ok = await subscribeToPush();
        setState(ok ? "granted" : "denied");
      }
    } finally {
      setBusy(false);
    }
  };

  if (state === "denied" || state === "unknown") {
    return null;
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-200 hover:border-primary transition-colors"
      type="button"
    >
      <div className="flex items-center gap-3">
        {state === "granted" ? (
          <Bell className="w-5 h-5 text-primary" />
        ) : (
          <BellOff className="w-5 h-5 text-gray-400" />
        )}
        <div className="text-right">
          <p className="font-medium text-gray-900 text-sm">
            {state === "granted" ? "تنبيهات الطلبات مفعّلة" : "فعّل تنبيهات الطلبات"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {state === "granted"
              ? "ننبّهك لما الطلب يتأكد، يجهز، أو يوصلك"
              : "اضغط للاشتراك"}
          </p>
        </div>
      </div>
      <span
        className={
          state === "granted"
            ? "text-xs font-medium text-red-600"
            : "text-xs font-medium text-primary"
        }
      >
        {state === "granted" ? "إيقاف" : "تفعيل"}
      </span>
    </button>
  );
}
