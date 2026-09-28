"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Optional range slider for page-size changes */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Total items for "showing X-Y of Z" text */
  total?: number;
  /** Disable interactions (e.g. during loading) */
  disabled?: boolean;
  className?: string;
}

/**
 * Generates a sliding window of page numbers with first/last always
 * visible, e.g. for page 7 of 20: 1 … 5 6 [7] 8 9 … 20
 */
function buildPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [];
  // Always show first
  pages.push(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  total,
  disabled = false,
  className = "",
}: PaginationProps) {
  const pages = useMemo(
    () => buildPageList(Math.min(Math.max(1, page), totalPages), totalPages),
    [page, totalPages],
  );

  if (totalPages <= 0) return null;

  const startItem = total != null ? (page - 1) * (pageSize ?? 0) + 1 : null;
  const endItem =
    total != null
      ? Math.min(page * (pageSize ?? 0), total)
      : null;

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50 ${className}`}
      dir="rtl"
    >
      {/* Info */}
      {total != null && startItem != null && endItem != null && (
        <p className="text-sm text-gray-500">
          عرض <span className="font-medium text-secondary">{startItem}</span>–
          <span className="font-medium text-secondary">{endItem}</span> من{" "}
          <span className="font-medium text-secondary">{total}</span>
        </p>
      )}

      <div className="flex items-center gap-1 flex-wrap justify-center">
        {/* First */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={disabled || page <= 1}
          aria-label="الصفحة الأولى"
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
        {/* Prev */}
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={disabled || page <= 1}
          aria-label="السابق"
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Page numbers */}
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`ellipsis-${i}`}
              className="w-9 h-9 flex items-center justify-center text-gray-400 text-sm select-none"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              disabled={disabled}
              aria-current={p === page ? "page" : undefined}
              className={`min-w-9 h-9 px-2 flex items-center justify-center text-sm rounded-lg transition-colors
                ${
                  p === page
                    ? "bg-primary text-white font-semibold shadow-sm"
                    : "text-gray-600 hover:bg-primary/10 hover:text-primary"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {p}
            </button>
          ),
        )}

        {/* Next */}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={disabled || page >= totalPages}
          aria-label="التالي"
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {/* Last */}
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={disabled || page >= totalPages}
          aria-label="الصفحة الأخيرة"
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Page size selector */}
      {onPageSizeChange && pageSize != null && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <label htmlFor="page-size-select" className="hidden sm:inline">
            لكل صفحة
          </label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={disabled}
            className="h-9 px-3 bg-white border-2 border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
