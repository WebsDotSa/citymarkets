"use client";

// Admin Notification Center — the multi-channel broadcast tabbed UI
// that replaces the legacy single WhatsApp settings page.
//
// Tabs:
//   Composer  → create / edit / schedule broadcasts
//   Campaigns → list of broadcasts with send / cancel / metrics / delete
//   Templates → reusable templates, channel-aware editor
//   Metrics   → aggregate performance + drill-down
//   Providers → channel provider status + legacy WhatsApp block

import { useState } from "react";
import { PageHeader } from "@/components/admin/admin-header";
import { NotificationsComposerTab } from "./NotificationsComposerTab";
import { NotificationsCampaignsTab } from "./NotificationsCampaignsTab";
import { NotificationsTemplatesTab } from "./NotificationsTemplatesTab";
import { NotificationsMetricsTab } from "./NotificationsMetricsTab";
import { NotificationsProvidersTab } from "./NotificationsProvidersTab";
import { broadcastApi } from "./api";
import type { Broadcast } from "./types";

type TabKey = "composer" | "campaigns" | "templates" | "metrics" | "providers";

const TABS: { key: TabKey; label: string; value: string }[] = [
  { key: "composer", label: "إنشاء بث", value: "composer" },
  { key: "campaigns", label: "الحملات", value: "campaigns" },
  { key: "templates", label: "القوالب", value: "templates" },
  { key: "metrics", label: "المؤشرات", value: "metrics" },
  { key: "providers", label: "الموفّرون", value: "providers" },
];

export function AdminNotificationCenter() {
  const [active, setActive] = useState<TabKey>("composer");
  const [editing, setEditing] = useState<Broadcast | null>(null);

  const switchTab = (key: TabKey) => {
    setActive(key);
    if (key !== "composer") setEditing(null);
  };

  return (
    <div>
      <PageHeader
        title="إعدادات الإشعارات"
        description="إنشاء حملات البث، إدارة القوالب، مراقبة المؤشرات، وربط الموفّرين (Push / SMS / Email / In-App)"
        badge={{ label: "5 قنوات", variant: "info" }}
        tabs={TABS.map((t) => ({ ...t, value: t.key }))}
        activeTab={active}
        onTabChange={(v) => switchTab(v as TabKey)}
      />

      {active === "composer" && (
        <NotificationsComposerTab
          initial={editing ?? undefined}
          onSaved={() => switchTab("campaigns")}
        />
      )}

      {active === "campaigns" && (
        <NotificationsCampaignsTab
          onViewMetrics={(id) => {
            void broadcastApi
              .getBroadcast(id)
              .then((b) => setEditing(b))
              .catch(() => null);
            switchTab("composer");
          }}
        />
      )}

      {active === "templates" && <NotificationsTemplatesTab />}

      {active === "metrics" && <NotificationsMetricsTab />}

      {active === "providers" && <NotificationsProvidersTab />}
    </div>
  );
}
