"use client";

// Campaigns tab — list of all broadcasts with status, channels,
// target metrics, and per-row actions (send / cancel / metrics / delete).

import { useEffect, useState } from "react";
import { Play, X, BarChart3, Trash2, Loader2 } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { useToast, useConfirm } from "@/components/ui/toast";
import { broadcastApi } from "./api";
import {
  CHANNELS,
  STATUS_LABEL,
  STATUS_VARIANT,
  type Broadcast,
  type BroadcastChannel,
} from "./types";

// data-table does not export `Column` — declare a minimal local one.
interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
  width?: string;
}

const VARIANT_CLASS: Record<string, string> = {
  default: "bg-slate-100 text-slate-600",
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
  danger: "bg-red-100 text-red-700",
};

function StatusPill({ status }: { status: Broadcast["status"] }) {
  const variant = STATUS_VARIANT[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${VARIANT_CLASS[variant]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ChannelChips({ channels }: { channels: BroadcastChannel[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {channels.map((c) => {
        const meta = CHANNELS.find((x) => x.value === c);
        return (
          <span
            key={c}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
          >
            <span aria-hidden>{meta?.icon ?? "•"}</span>
            <span>{meta?.label ?? c}</span>
          </span>
        );
      })}
    </div>
  );
}

export function NotificationsCampaignsTab({
  onViewMetrics,
}: {
  onViewMetrics?: (id: string) => void;
}) {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();
  const ask = useConfirm();

  const reload = async () => {
    setLoading(true);
    try {
      setRows(await broadcastApi.listBroadcasts());
    } catch (err) {
      showToast((err as Error).message || "فشل التحميل", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const sendNow = async (b: Broadcast) => {
    if (
      !(await ask({
        title: "إرسال البث",
        message: `هل تريد إرسال "${b.title}" الآن لجميع المستهدفين؟`,
        confirmLabel: "إرسال",
      }))
    ) {
      return;
    }
    setBusyId(b.id);
    try {
      const res = await broadcastApi.sendBroadcast(b.id);
      showToast(res.status === "scheduled" ? "تم جدولة البث" : "بدأ إرسال البث", "success");
      void reload();
    } catch (err) {
      showToast((err as Error).message || "فشل الإرسال", "error");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (b: Broadcast) => {
    if (
      !(await ask({
        title: "إلغاء البث",
        message: `هل تريد إلغاء "${b.title}"؟`,
        danger: true,
        confirmLabel: "إلغاء البث",
      }))
    ) {
      return;
    }
    setBusyId(b.id);
    try {
      await broadcastApi.cancelBroadcast(b.id);
      showToast("تم الإلغاء", "success");
      void reload();
    } catch (err) {
      showToast((err as Error).message || "فشل الإلغاء", "error");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (b: Broadcast) => {
    if (
      !(await ask({
        title: "حذف البث",
        message: `سيتم حذف "${b.title}" نهائياً مع جميع التسليمات. هل تريد المتابعة؟`,
        danger: true,
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(b.id);
    try {
      await broadcastApi.deleteBroadcast(b.id);
      showToast("تم الحذف", "success");
      void reload();
    } catch (err) {
      showToast((err as Error).message || "فشل الحذف", "error");
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<Broadcast>[] = [
    {
      key: "title",
      label: "العنوان",
      sortable: true,
      render: (r) => (
        <div className="max-w-xs">
          <p className="font-medium text-slate-800 truncate">{r.title}</p>
          <p className="text-xs text-slate-500 truncate">{r.body}</p>
        </div>
      ),
    },
    {
      key: "status",
      label: "الحالة",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "channels",
      label: "القنوات",
      render: (r) => <ChannelChips channels={r.channels} />,
    },
    {
      key: "audience",
      label: "الجمهور",
      render: (r) => (
        <span className="text-sm text-slate-600">
          {r.audience.type === "all"
            ? "الجميع"
            : (r.audience.segment ?? r.audience.loyalty_tier ?? r.audience.city ?? "مخصص")}
        </span>
      ),
    },
    {
      key: "scheduled_at",
      label: "الجدولة",
      render: (r) => {
        if (r.status === "sent" && r.started_at) {
          return <span className="text-sm text-slate-500">{formatDate(r.started_at)}</span>;
        }
        if (r.scheduled_at) {
          return <span className="text-sm text-primary">{formatDate(r.scheduled_at)}</span>;
        }
        return <span className="text-xs text-slate-400">فوري</span>;
      },
    },
    {
      key: "actions",
      label: "الإجراءات",
      render: (r) => {
        const busy = busyId === r.id;
        const canSend = r.status === "draft";
        const canCancel = r.status === "scheduled" || r.status === "sending";
        return (
          <div className="flex items-center gap-1 justify-end">
            {canSend && (
              <button
                type="button"
                onClick={() => sendNow(r)}
                disabled={busy}
                className="p-2 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-30"
                title="إرسال الآن"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => cancel(r)}
                disabled={busy}
                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-30"
                title="إلغاء"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onViewMetrics?.(r.id)}
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="المؤشرات"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => remove(r)}
              disabled={busy}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
              title="حذف"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      title="حملات البث"
      description="كل الإشعارات المُجدولة والمُرسلة مع حالة التسليم لكل قناة"
      columns={columns as never}
      data={rows as unknown as Record<string, unknown>[]}
      loading={loading}
      onRefresh={reload}
      searchPlaceholder="ابحث بالعنوان…"
    />
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ar-SA", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
