"use client";

// Ticking countdown for offers. Renders nothing meaningful when the
// target date has passed; the parent component decides what to show
// in that case.

import { useEffect, useState } from "react";

interface OfferCountdownProps {
  /** ISO timestamp or Date. */
  endsAt: string | Date;
  /** When true, show days/hours/minutes/seconds. */
  showSeconds?: boolean;
  /** Visual variant. */
  variant?: "default" | "compact" | "pill";
  className?: string;
}

interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function diff(target: number, now: number): Parts {
  const total = Math.max(0, target - now);
  const days = Math.floor(total / (24 * 60 * 60 * 1000));
  const hours = Math.floor((total / (60 * 60 * 1000)) % 24);
  const minutes = Math.floor((total / (60 * 1000)) % 60);
  const seconds = Math.floor((total / 1000) % 60);
  return { days, hours, minutes, seconds, total };
}

export function OfferCountdown({
  endsAt,
  showSeconds = true,
  variant = "default",
  className = "",
}: OfferCountdownProps) {
  const target = typeof endsAt === "string" ? new Date(endsAt).getTime() : endsAt.getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(target)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);

  if (Number.isNaN(target)) return null;

  const parts = diff(target, now);
  const ended = parts.total <= 0;

  if (ended) {
    return (
      <span
        className={`text-xs font-medium text-red-600 ${className}`}
        aria-label="انتهى العرض"
      >
        انتهى العرض
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span
        className={`text-2xs font-medium text-gray-600 tabular-nums ${className}`}
        aria-label={`ينتهي العرض بعد ${parts.days} يوم و${parts.hours} ساعة`}
      >
        {parts.days > 0 ? `${parts.days}ي ` : ""}
        {String(parts.hours).padStart(2, "0")}:
        {String(parts.minutes).padStart(2, "0")}
        {showSeconds ? `:${String(parts.seconds).padStart(2, "0")}` : ""}
      </span>
    );
  }

  if (variant === "pill") {
    return (
      <div
        className={`inline-flex items-center gap-1 bg-amber-100 text-amber-800 rounded-full px-2.5 py-1 text-2xs font-medium tabular-nums ${className}`}
        aria-label={`ينتهي العرض بعد ${parts.days} يوم و${parts.hours} ساعة و${parts.minutes} دقيقة`}
      >
        <span>ينتهي خلال</span>
        {parts.days > 0 ? <span>{parts.days}ي</span> : null}
        <span>{String(parts.hours).padStart(2, "0")}:{String(parts.minutes).padStart(2, "0")}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role="timer"
      aria-label={`ينتهي العرض بعد ${parts.days} يوم و${parts.hours} ساعة`}
    >
      <CountUnit value={parts.days} label="يوم" />
      <span className="text-gray-400">:</span>
      <CountUnit value={parts.hours} label="ساعة" />
      <span className="text-gray-400">:</span>
      <CountUnit value={parts.minutes} label="دقيقة" />
      {showSeconds ? (
        <>
          <span className="text-gray-400">:</span>
          <CountUnit value={parts.seconds} label="ثانية" />
        </>
      ) : null}
    </div>
  );
}

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center min-w-[2.5rem] bg-gray-900/90 text-white rounded-lg px-2 py-1.5">
      <span className="text-base font-bold tabular-nums leading-none">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[9px] opacity-70 mt-1">{label}</span>
    </div>
  );
}
