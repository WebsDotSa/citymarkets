"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Check,
  RefreshCw,
  Truck,
  X,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  CUSTOMER_PROGRESS_STEPS,
  getOrderStatusConfig,
} from '@/lib/orders';

/**
 * One row from `order_status_logs` joined with `admin_users` for the
 * human-readable name + role. Returned by `/api/v1/orders/[id]/timeline`.
 */
export interface OrderTimelineLog {
  old_status: string | null;
  new_status: string;
  changed_by_admin_id: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  /** Legacy literal — keeps older records searchable ("driver", "system:…"). */
  changed_by_legacy: string | null;
  /** Failure reason (driver-cancel), internal notes (admin), or null. */
  notes: string | null;
  created_at: string;
}

interface Props {
  /** Current order.status — drives the step-bar highlight. */
  currentStatus: string;
  /** Optional: full chronological history. Fetched automatically when omitted. */
  logs?: OrderTimelineLog[];
  /**
   * Endpoint to fetch logs from when `logs` is not provided.
   * Defaults to `/api/v1/orders/${orderId}/timeline`. Pass `null` to skip fetching.
   */
  orderId?: string;
  endpoint?: string | null;
  /** Visual variant. "page" = big card (customer). "compact" = small list (admin). */
  variant?: "page" | "compact";
}

/**
 * Shared order-timeline component.
 *
 * Renders two pieces:
 * 1. The 5-step horizontal bar (pending → confirmed → shopping → on_the_way →
 *    delivered), driven by `CUSTOMER_PROGRESS_STEPS` (canonical from
 *    `src/lib/order-status.ts`).
 * 2. A chronological event list built from `order_status_logs`. Each entry
 *    shows when the transition happened, who flipped it (admin name + role
 *    icon), and any notes (failure reason, internal note).
 *
 * The component is reused by both `/orders/[id]` (customer) and
 * `/admin/orders/[id]` (admin order detail). Phase 2 / P2.
 */
export function OrderTimeline({
  currentStatus,
  logs: providedLogs,
  orderId,
  endpoint,
  variant = "page",
}: Props) {
  // No state if caller passes logs directly (admin/server-rendered use).
  const [logs, setLogs] = useState<OrderTimelineLog[] | null>(
    providedLogs ?? null
  );
  const [loading, setLoading] = useState<boolean>(
    providedLogs === undefined && endpoint !== null
  );

  useEffect(() => {
    if (providedLogs !== undefined) return;
    if (endpoint === null) return;
    if (!orderId) return;
    let cancelled = false;
    const url = endpoint ?? `/api/v1/orders/${orderId}/timeline`;
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.success) setLogs(res.timeline ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId, endpoint, providedLogs]);

  const isCompact = variant === "compact";
  const progressSteps = CUSTOMER_PROGRESS_STEPS;
  const currentStepIndex = progressSteps.findIndex(
    (s) => s.status === currentStatus
  );
  // Cancelled orders should highlight the step they were at when cancelled,
  // not "delivered". Fall back to 0 if current status isn't in the step list.
  const effectiveIndex =
    currentStatus === "cancelled" ? -1 : Math.max(currentStepIndex, 0);

  return (
    <div className="space-y-4">
      {/* Step bar */}
      <div className={isCompact ? "" : "bg-white rounded-2xl p-6 shadow-sm"}>
        {!isCompact && (
          <div className="flex items-center justify-between mb-6">
            <span
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${getOrderStatusConfig(currentStatus).color}`}
            >
              {(() => {
                const Icon = getOrderStatusConfig(currentStatus).icon;
                return <Icon className="w-4 h-4" />;
              })()}
              {getOrderStatusConfig(currentStatus).label}
            </span>
          </div>
        )}
        <div className="relative">
          <div className="absolute top-6 right-6 left-6 h-1 bg-gray-200 rounded-full" />
          <div
            className="absolute top-6 right-6 h-1 bg-primary-600 rounded-full transition-all duration-500"
            style={{
              width: `${(Math.max(effectiveIndex, 0) / (progressSteps.length - 1)) * 100}%`,
            }}
          />
          <div className="flex justify-between relative">
            {progressSteps.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = index <= effectiveIndex;
              const isCurrent = index === effectiveIndex;
              return (
                <div
                  key={step.label}
                  className="flex flex-col items-center"
                >
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center z-10 transition-all ${
                      isCompleted
                        ? "bg-primary-600 text-white"
                        : "bg-gray-200 text-gray-400"
                    } ${isCurrent ? "ring-4 ring-primary-100" : ""}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-xs mt-2 font-medium ${
                      isCompleted ? "text-primary-600" : "text-gray-400"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Event log */}
      {!loading && logs && logs.length > 0 && (
        <div className={isCompact ? "" : "bg-white rounded-2xl p-6 shadow-sm"}>
          {!isCompact && (
            <h3 className="font-semibold text-gray-900 mb-3">سجل التحديثات</h3>
          )}
          <ol className="space-y-3">
            {logs.map((log, i) => (
              <TimelineEvent key={`${log.created_at}-${i}`} log={log} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function TimelineEvent({ log }: { log: OrderTimelineLog }) {
  const newStatus = getOrderStatusConfig(log.new_status);
  const StatusIcon: LucideIcon = newStatus.icon;
  const isSystem = !log.changed_by_admin_id;
  const RoleIcon: LucideIcon = isSystem ? Clock : ShieldCheck;
  const actorLabel =
    log.changed_by_name ??
    (log.changed_by_legacy === "driver"
      ? "السائق"
      : log.changed_by_legacy ?? "النظام");
  const actorRole =
    log.changed_by_role === "delivery_driver"
      ? "مندوب"
      : log.changed_by_role === "super_admin"
      ? "مدير عام"
      : log.changed_by_role === "admin"
      ? "إدارة"
      : null;

  return (
    <li className="flex items-start gap-3">
      <div
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
          isSystem ? "bg-gray-100 text-gray-600" : "bg-primary/10 text-primary"
        }`}
      >
        <RoleIcon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${newStatus.color}`}
          >
            <StatusIcon className="w-3 h-3" />
            {newStatus.label}
          </span>
          {log.old_status && (
            <>
              <span className="text-gray-400">من</span>
              <span className="text-xs text-gray-500">
                {getOrderStatusConfig(log.old_status).label}
              </span>
            </>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {actorLabel}
          {actorRole ? <span className="text-gray-400"> ({actorRole})</span> : null}
          {" • "}
          {new Date(log.created_at).toLocaleString("ar-SA")}
        </div>
        {log.notes && (
          <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded-lg p-2">
            {log.notes}
          </p>
        )}
      </div>
    </li>
  );
}