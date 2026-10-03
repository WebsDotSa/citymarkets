"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional secondary text shown under the label */
  hint?: string;
  /** Optional disabled flag */
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  /** Show a search input — defaults to true */
  searchable?: boolean;
  /** Show a clear (×) button when value is set */
  allowClear?: boolean;
  /** Disable the field */
  disabled?: boolean;
  /** Field name for form submissions */
  name?: string;
  /** Optional id */
  id?: string;
  /** Renders full width */
  fullWidth?: boolean;
  /** Optional class on the trigger button */
  className?: string;
  /** Optional aria-label */
  ariaLabel?: string;
  /** Empty state text when no results match */
  emptyText?: string;
  /** Hide the empty placeholder option (when value === "") */
  hideEmptyOption?: boolean;
  /** Right-side icon (e.g. lucide icon) */
  rightIcon?: React.ReactNode;
}

/**
 * Lightweight, accessible single-select with built-in search — no jQuery.
 * Designed as a drop-in replacement for native <select> when you need
 * search + keyboard navigation + RTL support.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "اختر...",
  searchable = true,
  allowClear = true,
  disabled = false,
  name,
  id,
  fullWidth = true,
  className = "",
  ariaLabel,
  emptyText = "لا توجد نتائج",
  hideEmptyOption = false,
  rightIcon,
}: SearchableSelectProps) {
  const reactId = useId();
  const fieldId = id ?? `searchable-select-${reactId}`;
  const listboxId = `${fieldId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        listRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (open && searchable) {
      // small delay so the input is mounted before focusing
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, searchable]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [filtered.length, open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    triggerRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          setActiveIndex((i) =>
            i < filtered.length - 1 ? i + 1 : 0,
          );
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) {
          setActiveIndex((i) =>
            i > 0 ? i - 1 : filtered.length - 1,
          );
        }
        break;
      case "Enter":
        e.preventDefault();
        if (open && activeIndex >= 0 && filtered[activeIndex]) {
          handleSelect(filtered[activeIndex].value);
        } else if (!open) {
          setOpen(true);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setQuery("");
          setActiveIndex(-1);
        }
        break;
      case "Tab":
        if (open) {
          setOpen(false);
          setQuery("");
          setActiveIndex(-1);
        }
        break;
    }
  };

  const showEmptyOption = !hideEmptyOption && value === "" && !open;
  const triggerLabel = selected ? selected.label : placeholder;

  return (
    <div
      className={`relative ${fullWidth ? "w-full" : ""} ${className}`}
      dir="rtl"
    >
      {/* Hidden native input for form submission */}
      {name && <input type="hidden" name={name} value={value} />}

      <button
        ref={triggerRef}
        type="button"
        id={fieldId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`w-full h-11 px-4 bg-gray-50 border-2 rounded-xl text-sm flex items-center justify-between gap-2 transition-all
          ${
            open
              ? "border-primary bg-white ring-4 ring-primary/10"
              : "border-gray-200 hover:border-gray-300"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${selected ? "text-secondary font-medium" : "text-gray-500"}
          focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10`}
      >
        <span className="flex items-center gap-2 truncate">
          {rightIcon}
          <span className="truncate">{triggerLabel}</span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {allowClear && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
              aria-label="مسح الاختيار"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${
              open ? "rotate-180 text-primary" : ""
            }`}
          />
        </span>
      </button>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white border-2 border-gray-200 rounded-xl shadow-xl shadow-gray-200/50 overflow-hidden"
        >
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ابحث..."
                  className="w-full h-10 pr-9 pl-3 border-2 border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          )}

          <ul
            id={listboxId}
            role="listbox"
            className="max-h-64 overflow-y-auto py-1"
          >
            {!hideEmptyOption && (
              <li
                role="option"
                aria-selected={value === ""}
                onClick={() => handleSelect("")}
                className={`px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between hover:bg-primary/5 ${
                  value === "" ? "bg-primary/10 text-primary font-medium" : "text-gray-600"
                }`}
              >
                <span>{placeholder}</span>
                {value === "" && <Check className="w-4 h-4 text-primary" />}
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-sm text-gray-400 text-center">
                {emptyText}
              </li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <li
                    key={opt.value || `opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => !opt.disabled && handleSelect(opt.value)}
                    className={`px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between gap-2 transition-colors
                      ${opt.disabled ? "opacity-50 cursor-not-allowed" : ""}
                      ${
                        isActive
                          ? "bg-primary text-white"
                          : isSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-gray-700 hover:bg-primary/5"
                      }`}
                  >
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{opt.label}</span>
                      {opt.hint && (
                        <span
                          className={`text-xs truncate ${
                            isActive ? "text-white/80" : "text-gray-400"
                          }`}
                        >
                          {opt.hint}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? "text-white" : "text-primary"
                        }`}
                      />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
