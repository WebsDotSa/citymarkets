"use client";

import { useEffect, useId, useMemo, useRef, useState, useCallback } from "react";
import { Search, X, ChevronDown, Check } from "lucide-react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  emptyMessage?: string;
  allowClear?: boolean;
  /** Forces the search input to always show, even when options list is short. */
  searchable?: boolean;
  /** Show the placeholder as an extra "no selection" entry at the top of the list. */
  includePlaceholderOption?: boolean;
  /** Optional id used for aria-controls / listbox id (defaults to a generated one). */
  id?: string;
}

const DEFAULT_EMPTY = "لا توجد نتائج";

/**
 * SearchableSelect — accessible combobox with type-to-filter.
 *
 * Self-contained React component (no jQuery, no Select2). Renders a button
 * trigger with the selected label and a popover containing a search input
 * + scrollable option list. Keyboard navigation: ↓/↑ to move highlight,
 * Enter to select, Esc to close, Tab to close and blur.
 *
 * Used directly by entity-field forms and indirectly via `Select2Field`
 * (which previously initialised jQuery Select2) for any `AdminForm` config
 * with `field.type: "select2"`.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "اختر...",
  disabled = false,
  required = false,
  className = "",
  emptyMessage = DEFAULT_EMPTY,
  allowClear = true,
  searchable = true,
  includePlaceholderOption = true,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Stable id for ARIA wiring.
  const reactId = useId();
  const fieldId = id ?? `searchable-select-${reactId}`;
  const listboxId = `${fieldId}-listbox`;

  // Build the rendered options list (with optional placeholder sentinel).
  const renderedOptions = useMemo<SearchableSelectOption[]>(() => {
    if (includePlaceholderOption) {
      return [{ value: "", label: placeholder }, ...options];
    }
    return options;
  }, [includePlaceholderOption, placeholder, options]);

  // Filter by substring (Arabic-safe: case-insensitive via toLocaleLowerCase("ar")).
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return renderedOptions;
    const needle = q.toLocaleLowerCase("ar");
    return renderedOptions.filter((o) =>
      o.label.toLocaleLowerCase("ar").includes(needle),
    );
  }, [renderedOptions, query]);

  // Selected label for the trigger display.
  const selectedOption = useMemo(
    () => renderedOptions.find((o) => o.value === value),
    [renderedOptions, value],
  );

  // Reset highlight when the filtered set changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      // Defer to allow popover render before focusing.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  // Click outside closes the popover.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const choose = useCallback(
    (v: string) => {
      onChange(v);
      close();
      // Return focus to the trigger so keyboard users stay oriented.
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onChange, close],
  );

  const clear = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onChange("");
      // Keep focus on the trigger; popover stays closed.
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) =>
        filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) choose(pick.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      // Let Tab close + blur naturally.
      close();
    }
  };

  const triggerClasses =
    "w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={fieldId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        className={triggerClasses}
      >
        <span
          className={`truncate text-start flex-1 ${
            selectedOption && selectedOption.value !== ""
              ? "text-secondary"
              : "text-gray-400"
          }`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {allowClear && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="مسح الاختيار"
              onClick={clear}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {open && !disabled && (
        <div
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
          role="presentation"
        >
          {searchable && (
            <div className="p-2 border-b border-gray-100 bg-gray-50/50">
              <div className="relative">
                <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onListKeyDown}
                  placeholder="ابحث..."
                  className="w-full h-9 pe-9 ps-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    filtered[highlight] ? `${listboxId}-opt-${highlight}` : undefined
                  }
                />
              </div>
            </div>
          )}
          <ul
            id={listboxId}
            role="listbox"
            className="max-h-60 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-500 text-center">
                {emptyMessage}
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlight;
                return (
                  <li
                    key={`${opt.value}-${idx}`}
                    id={`${listboxId}-opt-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => choose(opt.value)}
                    className={`flex items-center justify-between gap-2 px-4 py-2 text-sm cursor-pointer ${
                      isHighlighted ? "bg-primary/5" : ""
                    } ${
                      isSelected ? "text-primary font-medium" : "text-secondary"
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-primary" />}
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