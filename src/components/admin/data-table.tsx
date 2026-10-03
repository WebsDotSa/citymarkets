"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Plus, Edit2, Trash2, ChevronLeft, ChevronRight, RefreshCw, Filter, Download, MoreVertical, Eye, CheckCircle, XCircle, ArrowUpDown } from "lucide-react";

// Select2 types
declare global {
  interface Window {
    $: any;
    jQuery: any;
  }
}

interface Column<T extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  label: string;
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  width?: string;
}

interface FilterOption {
  key: string;
  label: string;
  options: { label: string; value: string }[];
}

interface DataTableProps<T extends Record<string, unknown> = Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  title: string;
  description?: string;
  onAdd?: () => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  onView?: (row: T) => void;
  onRefresh?: () => void;
  onBulkAction?: (selectedIds: (string | number)[], action: string) => void;
  loading?: boolean;
  total?: number;
  addLabel?: string;
  searchPlaceholder?: string;
  filters?: FilterOption[];
  exportable?: boolean;
  selectable?: boolean;
  rowClassName?: (row: T) => string;
  emptyState?: {
    title: string;
    description: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  };
}

export function DataTable<T extends Record<string, unknown> = Record<string, unknown>>(
  props: DataTableProps<T>,
) {
  const {
    columns,
    data,
    title,
    description,
    onAdd,
    onEdit,
    onDelete,
    onView,
    onRefresh,
    onBulkAction,
    loading = false,
    total,
    addLabel = "إضافة جديد",
    searchPlaceholder = "بحث...",
    filters = [],
    exportable = false,
    selectable = false,
    rowClassName,
    emptyState,
  } = props;

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [select2Initialized, setSelect2Initialized] = useState(false);
  const select2Refs = useRef<Record<string, string>>({});
  const tableRef = useRef<HTMLDivElement>(null);

  // Initialize Select2
  useEffect(() => {
    if (typeof window !== "undefined" && window.$ && window.$.fn.select2) {
      setSelect2Initialized(true);
    }
  }, []);

  // Filter data based on search and active filters
  const filteredData = useMemo(() => {
    let result = [...data];

    // Apply search
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key];
          return val && String(val).toLowerCase().includes(searchLower);
        })
      );
    }

    // Apply filters
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value) {
        result = result.filter((row) => String(row[key]) === value);
      }
    });

    // Apply sorting
    if (sortColumn) {
      result.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        if (aVal === bVal) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const comparison = String(aVal).localeCompare(String(bVal), "ar");
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [data, search, activeFilters, sortColumn, sortDirection, columns]);

  // Pagination
  const totalPages = Math.ceil(filteredData.length / pageSize);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Handle sort
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === paginatedData.length) {
      setSelectedRows(new Set<string | number>());
    } else {
      setSelectedRows(new Set(paginatedData.map((row) => row.id as string | number)));
    }
  }, [paginatedData, selectedRows.size]);

  // Handle row select
  const handleSelectRow = useCallback((id: string | number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Reset page when search/filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeFilters]);

  // Count active filters
  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length;

  // Default empty state
  const defaultEmptyState: {
    title: string;
    description: string;
    action?: { label: string; onClick: () => void };
  } = {
    title: "لا توجد بيانات",
    description: search || activeFilterCount > 0
      ? `لا توجد نتائج للبحث "${search}"`
      : "ابدأ بإضافة بيانات جديدة",
  };

  const displayEmptyState = emptyState || defaultEmptyState;

  return (
    <div className="space-y-4" ref={tableRef}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
          {description && (
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="admin-btn-icon admin-btn-ghost"
              title="تحديث"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
          {exportable && (
            <button className="admin-btn-icon admin-btn-ghost" title="تصدير">
              <Download className="w-5 h-5" />
            </button>
          )}
          {onAdd && (
            <button onClick={onAdd} className="admin-btn-primary">
              <Plus className="w-4 h-4" />
              <span>{addLabel}</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filters Bar */}
      <div className="admin-card p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-11 pr-10 pl-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:bg-white transition-all"
            />
          </div>

          {/* Filter Toggle */}
          {filters.length > 0 && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`admin-btn admin-btn-outline relative ${
                activeFilterCount > 0 ? "border-primary text-primary" : ""
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>تصفية</span>
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -left-1 w-5 h-5 bg-primary text-white text-xs rounded-full flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}

          {/* Page Size */}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-11 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value={10}>10 صفوف</option>
            <option value={25}>25 صف</option>
            <option value={50}>50 صف</option>
            <option value={100}>100 صف</option>
          </select>
        </div>

        {/* Filter Panel */}
        {showFilters && filters.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 admin-animate-slide-up">
            {filters.map((filter) => (
              <div key={filter.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600">
                  {filter.label}
                </label>
                <select
                  value={activeFilters[filter.key] || ""}
                  onChange={(e) =>
                    setActiveFilters((prev) => ({
                      ...prev,
                      [filter.key]: e.target.value,
                    }))
                  }
                  className="admin-select text-sm"
                >
                  <option value="">الكل</option>
                  {filter.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button
                  onClick={() => setActiveFilters({})}
                  className="admin-btn admin-btn-ghost text-sm text-red-500"
                >
                  مسح الفلاتر
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk Actions */}
      {selectable && selectedRows.size > 0 && (
        <div className="admin-card p-4 bg-primary/5 border-primary/20 admin-animate-slide-up">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              تم تحديد {selectedRows.size} عنصر
            </span>
            <div className="flex items-center gap-2">
              {onBulkAction && (
                <>
                  <button
                    onClick={() => onBulkAction(Array.from(selectedRows), "delete")}
                    className="admin-btn admin-btn-sm admin-btn-danger"
                  >
                    <Trash2 className="w-4 h-4" />
                    حذف المحدد
                  </button>
                  <button
                    onClick={() => onBulkAction(Array.from(selectedRows), "export")}
                    className="admin-btn admin-btn-sm admin-btn-secondary"
                  >
                    <Download className="w-4 h-4" />
                    تصدير
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedRows(new Set())}
                className="admin-btn admin-btn-sm admin-btn-ghost"
              >
                إلغاء التحديد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="admin-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="admin-spinner" />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon">
              <Search className="w-10 h-10" />
            </div>
            <h3 className="admin-empty-title">{displayEmptyState.title}</h3>
            <p className="admin-empty-description">{displayEmptyState.description}</p>
            {displayEmptyState.action && (
              <button
                onClick={displayEmptyState.action.onClick}
                className="admin-btn-primary"
              >
                {displayEmptyState.action.label}
              </button>
            )}
            {search && (
              <button
                onClick={() => setSearch("")}
                className="mt-4 text-sm text-primary hover:underline"
              >
                مسح البحث
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    {selectable && (
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedRows.size === paginatedData.length}
                          onChange={handleSelectAll}
                          className="admin-checkbox"
                        />
                      </th>
                    )}
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${
                          col.sortable ? "cursor-pointer hover:text-gray-700" : ""
                        } ${col.className || ""}`}
                        style={{ width: col.width }}
                        onClick={() => col.sortable && handleSort(col.key)}
                      >
                        <div className="flex items-center gap-2">
                          {col.label}
                          {col.sortable && (
                            <ArrowUpDown className="w-3 h-3 opacity-50" />
                          )}
                        </div>
                      </th>
                    ))}
                    {(onEdit || onDelete || onView) && (
                      <th className="w-32 px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-center">
                        الإجراءات
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((row, index) => (
                    <tr
                      key={index}
                      className={`${rowClassName?.(row) || ""} ${
                        selectedRows.has(row.id as string | number) ? "bg-primary/5" : ""
                      }`}
                    >
                      {selectable && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedRows.has(row.id as string | number)}
                            onChange={() => handleSelectRow(row.id as string | number)}
                            className="admin-checkbox"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 text-sm ${col.className || ""}`}
                        >
                          {col.render
                            ? col.render(row, index)
                            : String(row[col.key] ?? "—")}
                        </td>
                      ))}
                      {(onEdit || onDelete || onView) && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {onView && (
                              <button
                                onClick={() => onView(row)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="عرض"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            {onEdit && (
                              <button
                                onClick={() => onEdit(row)}
                                className="p-2 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                title="تعديل"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {onDelete && (
                              <button
                                onClick={() => onDelete(row)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden divide-y divide-gray-100">
              {paginatedData.map((row, index) => (
                <div key={index} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id as string | number)}
                        onChange={() => handleSelectRow(row.id as string | number)}
                        className="admin-checkbox mt-1"
                      />
                    )}
                    <div className="flex-1">
                      {columns.slice(0, 3).map((col) => (
                        <div key={col.key} className="flex items-center justify-between py-1.5">
                          <span className="text-xs text-gray-400">{col.label}</span>
                          <span className="text-sm text-gray-700 text-right">
                            {col.render
                              ? col.render(row, index)
                              : String(row[col.key] ?? "—")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    {onView && (
                      <button
                        onClick={() => onView(row)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
                      >
                        <Eye className="w-4 h-4" /> عرض
                      </button>
                    )}
                    {onEdit && (
                      <button
                        onClick={() => onEdit(row)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-primary bg-primary/10 rounded-lg hover:bg-primary/20"
                      >
                        <Edit2 className="w-4 h-4" /> تعديل
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(row)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                      >
                        <Trash2 className="w-4 h-4" /> حذف
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-sm text-gray-500">
              عرض {(currentPage - 1) * pageSize + 1} -{" "}
              {Math.min(currentPage * pageSize, filteredData.length)} من{" "}
              {filteredData.length}
              {total !== undefined && ` (الإجمالي: ${total})`}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-9 h-9 text-sm rounded-lg transition-colors ${
                      currentPage === page
                        ? "bg-primary text-white shadow-lg shadow-primary/20"
                        : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Confirm Dialog Component
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  variant = "danger",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const iconMap = {
    danger: (
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
        <XCircle className="w-6 h-6 text-red-600" />
      </div>
    ),
    warning: (
      <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-amber-600" />
      </div>
    ),
    info: (
      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
        <CheckCircle className="w-6 h-6 text-blue-600" />
      </div>
    ),
  };

  const btnMap = {
    danger: "admin-btn-danger",
    warning: "admin-btn-warning",
    info: "admin-btn-primary",
  };

  return (
    <div className="admin-modal-overlay admin-animate-fade-in" onClick={onCancel}>
      <div
        className="admin-modal admin-animate-scale-in max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 flex flex-col items-center text-center">
          {iconMap[variant]}
          <h3 className="text-lg font-bold text-gray-800 mt-4">{title}</h3>
          <p className="text-sm text-gray-500 mt-2">{message}</p>
        </div>
        <div className="flex items-center justify-center gap-3 px-6 pb-6">
          <button onClick={onCancel} className="admin-btn admin-btn-outline" disabled={loading}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={`admin-btn ${btnMap[variant]}`} disabled={loading}>
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Missing icons
function AlertCircle({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
