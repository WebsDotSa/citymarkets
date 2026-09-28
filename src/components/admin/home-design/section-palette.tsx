"use client";

/**
 * Section palette — the right-rail grid of section types the admin
 * can add to the home layout. Renders a card per library entry; click
 * triggers `onAdd(type)` so the parent can insert a new section.
 *
 * Icon names come from `SECTION_LIBRARY` and are mapped to lucide-react
 * components at render time — keeps the library entries plain data.
 */
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
  type LucideIcon,
} from "lucide-react";
import { SECTION_LIBRARY, type SectionType } from "@/lib/home-layout-types";

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

interface SectionPaletteProps {
  onAdd: (type: SectionType) => void;
}

export function SectionPalette({ onAdd }: SectionPaletteProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-secondary">إضافة قسم</p>
        <p className="text-xs text-gray-500">انقر لإضافة قسم للصفحة الرئيسية</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SECTION_LIBRARY.map((entry) => {
          const Icon = ICON_MAP[entry.icon] ?? ImageIcon;
          return (
            <button
              key={entry.type}
              type="button"
              onClick={() => onAdd(entry.type)}
              className="group p-3 rounded-xl border border-gray-200 bg-white text-right hover:border-primary hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary mb-2 group-hover:bg-primary group-hover:text-white transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-secondary">{entry.label}</p>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{entry.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}