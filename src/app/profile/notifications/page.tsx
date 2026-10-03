"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { PushOptIn } from "@/components/PushOptIn";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

const PREF_KEY = "cm-notif-prefs";

interface Prefs {
  order_updates: boolean;
  promos: boolean;
  delivery_alerts: boolean;
}

const DEFAULTS: Prefs = {
  order_updates: true,
  promos: false,
  delivery_alerts: true,
};

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREF_KEY);
      if (stored) setPrefs({ ...DEFAULTS, ...JSON.parse(stored) });
    } catch {}
  }, []);

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {}
  };

  return (
    <main className="min-h-[80vh] bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <PageHeader
          icon={<Bell className="w-6 h-6 text-primary" />}
          title="الإشعارات"
          subtitle="تحكم كيف تبي نوصلّك التحديثات"
          className="mb-6"
        />

        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">إشعارات المتصفح</h2>
          <Card>
            <PushOptIn />
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">تفضيلات الإشعارات</h2>
          <Card className="divide-y divide-gray-100">
            <Toggle
              label="تحديثات الطلب"
              description="تأكيد، تجهيز، توصيل"
              checked={prefs.order_updates}
              onChange={(v) => update("order_updates", v)}
            />
            <Toggle
              label="تنبيهات التوصيل"
              description="لما السائق قريب"
              checked={prefs.delivery_alerts}
              onChange={(v) => update("delivery_alerts", v)}
            />
            <Toggle
              label="عروض وتخفيضات"
              description="من وقت للثاني"
              checked={prefs.promos}
              onChange={(v) => update("promos", v)}
            />
          </Card>
          {saved && (
            <p className="text-xs text-primary mt-2 text-center">تم الحفظ</p>
          )}
        </section>
      </div>
    </main>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 p-4 cursor-pointer">
      <div>
        <p className="font-medium text-gray-900 text-sm">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative w-11 h-6 rounded-full transition-colors flex-shrink-0 " +
          (checked ? "bg-primary" : "bg-gray-300")
        }
      >
        <span
          className={
            "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform " +
            (checked ? "right-0.5" : "right-[1.375rem]")
          }
        />
      </button>
    </label>
  );
}
