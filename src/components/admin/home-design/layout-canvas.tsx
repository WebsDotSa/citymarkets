"use client";

/**
 * Layout canvas — the center column listing every section in order.
 *
 * Per the 2026-09-25 product decision, reordering is via up/down buttons
 * (not drag-and-drop). This keeps the canvas simple, accessible, and
 * stable on mobile without pulling in a DnD library.
 *
 * The component is purely controlled — the parent owns the sections
 * array and passes the new one after each action.
 */
import {
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { getLibraryEntry, type Section, type SectionType } from "@/lib/home-layout-types";

// Inline imports mirror the palette's ICON_MAP — keeps render cheap.
import {
  Image as ImageIcon,
  Images,
  Grid3x3,
  Package,
  Sparkles,
  Flame,
  Zap,
  FolderTree,
  Store,
  TicketPercent,
  FileText,
  Megaphone,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  ImageIcon,
  Images,
  Grid3x3,
  Package,
  Sparkles,
  Flame,
  Zap,
  FolderTree,
  Store,
  TicketPercent,
  FileText,
  Megaphone,
};

interface LayoutCanvasProps {
  sections: Section[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
}

export function LayoutCanvas({
  sections,
  selectedId,
  onSelect,
  onMove,
  onToggleVisibility,
  onDelete,
}: LayoutCanvasProps) {
  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white rounded-2xl border-2 border-dashed border-gray-200">
        <p className="text-2xl mb-2">🧱</p>
        <p className="text-base font-semibold text-secondary mb-1">لا توجد أقسام بعد</p>
        <p className="text-sm text-gray-500 max-w-md">
          ابدأ بإضافة قسم من اللوحة على اليمين. القسم الأول يظهر أعلى الصفحة الرئيسية.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => {
        const entry = getLibraryEntry(section.type as SectionType);
        const Icon = ICON_MAP[entry?.icon ?? "ImageIcon"] ?? ImageIcon;
        const isFirst = idx === 0;
        const isLast = idx === sections.length - 1;
        const isSelected = section.id === selectedId;

        return (
          <div
            key={section.id}
            className={[
              "group flex items-center gap-2 p-3 bg-white rounded-xl border transition-all",
              isSelected
                ? "border-primary shadow-sm ring-2 ring-primary/20"
                : "border-gray-200 hover:border-gray-300",
              !section.visible ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => onMove(section.id, "up")}
                disabled={isFirst}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="نقل للأعلى"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMove(section.id, "down")}
                disabled={isLast}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="نقل للأسفل"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSelect(section.id)}
              className="flex-1 flex items-center gap-3 text-right"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-secondary truncate">
                  {entry?.label ?? section.type}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  موضع {idx + 1} من {sections.length}
                  {!section.visible && " • مخفي"}
                </p>
              </div>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onToggleVisibility(section.id)}
                className="p-2 rounded hover:bg-gray-100"
                aria-label={section.visible ? "إخفاء" : "إظهار"}
                title={section.visible ? "إخفاء" : "إظهار"}
              >
                {section.visible ? (
                  <Eye className="w-4 h-4 text-gray-700" />
                ) : (
                  <EyeOff className="w-4 h-4 text-gray-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                className="p-2 rounded hover:bg-gray-100"
                aria-label="تعديل"
                title="تعديل"
              >
                <Pencil className="w-4 h-4 text-gray-700" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(section.id)}
                className="p-2 rounded hover:bg-red-50 text-red-500"
                aria-label="حذف"
                title="حذف"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}