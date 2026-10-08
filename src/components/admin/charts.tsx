"use client";

/**
 * Shared chart primitives for the admin analytics surfaces.
 *
 * Built on plain CSS — no chart library. Browser support is wide and
 * the visual is consistent with the existing admin dashboard pattern
 * (`admin-dashboard.tsx` revenue chart).
 */

/**
 * Single horizontal bar with a label and value.
 */
export function BarRow({
  label,
  value,
  max,
  suffix,
  emphasis = "primary",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  emphasis?: "primary" | "neutral" | "success" | "warning" | "danger";
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fill =
    emphasis === "neutral"
      ? "bg-gray-500"
      : emphasis === "success"
      ? "bg-emerald-500"
      : emphasis === "warning"
      ? "bg-amber-500"
      : emphasis === "danger"
      ? "bg-red-500"
      : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600 truncate">{label}</span>
        <span className="font-medium text-secondary tabular-nums">
          {suffix ?? value}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${fill}`}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Card-wrapped bar chart. Each row uses a BarRow.
 */
export function BarChart({
  title,
  subtitle,
  rows,
  valueKey,
  labelKey,
  formatValue,
  emptyText = "لا توجد بيانات",
}: {
  title: string;
  subtitle?: string;
  rows: Array<Record<string, unknown>>;
  valueKey: string;
  labelKey: string;
  formatValue?: (v: number) => string;
  emptyText?: string;
}) {
  const values = rows.map((r) => Number(r[valueKey]) || 0);
  const max = Math.max(...values, 1);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-bold text-secondary">{title}</h2>
        {subtitle && (
          <span className="text-xs text-gray-400">{subtitle}</span>
        )}
      </div>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">{emptyText}</p>
        ) : (
          rows.map((row, i) => (
            <BarRow
              key={i}
              label={String(row[labelKey])}
              value={Number(row[valueKey]) || 0}
              max={max}
              suffix={formatValue?.(Number(row[valueKey]) || 0)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Inline sparkline (peak/val mini chart). Renders the bar values
 * as a connected polyline using stroke-dasharray for the area fill.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = "currentColor",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="text-gray-300" />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline
        points={polyline}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Period selector (7d / 30d / 90d). Matches the existing site's tone.
 */
export function PeriodSelector({
  value,
  onChange,
}: {
  value: "7d" | "30d" | "90d";
  onChange: (v: "7d" | "30d" | "90d") => void;
}) {
  const opts: Array<{ value: "7d" | "30d" | "90d"; label: string }> = [
    { value: "7d", label: "7 أيام" },
    { value: "30d", label: "30 يوم" },
    { value: "90d", label: "90 يوم" },
  ];
  return (
    <div className="inline-flex items-center bg-white rounded-xl border border-gray-200 p-1">
      {opts.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              active
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
