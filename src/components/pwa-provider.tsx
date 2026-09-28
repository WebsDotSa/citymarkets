"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const STORAGE_KEY = "cm-install-dismissed";
const DISMISS_DAYS = 7;

export function PWAProvider() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Register service worker.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[pwa] sw registration failed:", err));
    }

    // Listen for install prompt.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      // Don't show if recently dismissed.
      const dismissedAt = localStorage.getItem(STORAGE_KEY);
      if (dismissedAt) {
        const age = Date.now() - Number(dismissedAt);
        if (age < DISMISS_DAYS * 24 * 60 * 60 * 1000) return;
      }
      setDeferred(e as BeforeInstallPromptEvent);
      // Slight delay so the page settles first.
      setTimeout(() => setShow(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const install = async () => {
    if (!deferred) return;
    setShow(false);
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  };

  if (!show || !deferred) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-sm animate-in slide-in-from-bottom-4"
      role="dialog"
      aria-label="تثبيت التطبيق"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 flex items-center gap-3">
        <img
          src="/android-chrome-192x192.png"
          alt=""
          className="w-12 h-12 rounded-xl flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">ثبّت تطبيق أسواق سيتي</p>
          <p className="text-xs text-gray-500 mt-0.5">وصول أسرع، تنبيهات فورية</p>
        </div>
        <button
          onClick={install}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-dark flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5" />
          تثبيت
        </button>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
          aria-label="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
