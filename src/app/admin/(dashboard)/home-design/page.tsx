"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Smartphone, Monitor, Save, Eye, RotateCcw, X, Loader2 } from "lucide-react";
import { useToast, useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from '@/lib/catalog';
import { Button } from "@/components/design/button";
import { SectionPalette } from "@/components/admin/home-design/section-palette";
import { LayoutCanvas } from "@/components/admin/home-design/layout-canvas";
// SectionEditor is 938 lines / 32 KB and only renders inside the editor
// drawer (when the user clicks a section). Lazy-load it so the initial
// admin /home-design payload skips it.
const SectionEditor = dynamic(
  () => import("@/components/admin/home-design/section-editor").then((m) => m.SectionEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        جاري تحميل المحرر...
      </div>
    ),
  },
);
import {
  DEVICE_TYPES,
  makeDefaultSection,
  type DeviceType,
  type Section,
  type SectionType,
} from '@/lib/catalog';

type AdminLayoutResponse = {
  id: string;
  device_type: DeviceType;
  name: string;
  sections: Section[];
  is_active: boolean;
  updated_at: string;
  created_at: string;
};

type DraftMap = Record<DeviceType, Section[]>;

const EMPTY_DRAFT: DraftMap = {
  mobile: [],
  desktop: [],
};

export default function HomeDesignAdminPage() {
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [activeDevice, setActiveDevice] = useState<DeviceType>("mobile");
  const [drafts, setDrafts] = useState<DraftMap>(EMPTY_DRAFT);
  const [names, setNames] = useState<Record<DeviceType, string>>({ mobile: "الافتراضي - جوال", desktop: "الافتراضي - كمبيوتر" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // ─── load both layouts in parallel ────────────────────────────
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const responses = await Promise.all(
          DEVICE_TYPES.map(async (device) => {
            const res = await apiFetch<AdminLayoutResponse>(`/api/admin/home-layout?device=${device}`, {
              signal: ac.signal,
            });
            return { device, res };
          }),
        );
        if (ac.signal.aborted) return;
        const next: DraftMap = { mobile: [], desktop: [] };
        const nextNames: Record<DeviceType, string> = { mobile: "", desktop: "" };
        for (const { device, res } of responses) {
          if (res.success && res.data) {
            next[device] = Array.isArray(res.data.sections) ? res.data.sections : [];
            nextNames[device] = res.data.name;
          }
        }
        setDrafts(next);
        setNames(nextNames);
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error(err);
          showToast("فشل تحميل التصاميم", "error");
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [showToast]);

  // ─── mutate local draft ───────────────────────────────────────
  const updateSections = useCallback(
    (device: DeviceType, next: Section[]) => {
      setDrafts((prev) => ({ ...prev, [device]: next }));
    },
    [],
  );

  const handleAdd = useCallback(
    (type: SectionType) => {
      const section = makeDefaultSection(type);
      setDrafts((prev) => ({
        ...prev,
        [activeDevice]: [...prev[activeDevice], section],
      }));
      setSelectedId(section.id);
      setEditorOpen(true);
    },
    [activeDevice],
  );

  const handleMove = useCallback(
    (id: string, direction: "up" | "down") => {
      setDrafts((prev) => {
        const list = [...prev[activeDevice]];
        const idx = list.findIndex((s) => s.id === id);
        if (idx < 0) return prev;
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= list.length) return prev;
        [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
        return { ...prev, [activeDevice]: list };
      });
    },
    [activeDevice],
  );

  const handleToggleVisibility = useCallback(
    (id: string) => {
      setDrafts((prev) => ({
        ...prev,
        [activeDevice]: prev[activeDevice].map((s) =>
          s.id === id ? ({ ...s, visible: !s.visible } as Section) : s,
        ),
      }));
    },
    [activeDevice],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          title: "حذف القسم",
          message: "هل أنت متأكد من حذف هذا القسم؟",
          danger: true,
        }))
      )
        return;
      setDrafts((prev) => ({
        ...prev,
        [activeDevice]: prev[activeDevice].filter((s) => s.id !== id),
      }));
      if (selectedId === id) {
        setSelectedId(null);
        setEditorOpen(false);
      }
      showToast("تم حذف القسم", "success");
    },
    [activeDevice, selectedId, confirm, showToast],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditorOpen(true);
  }, []);

  const handleEditorChange = useCallback(
    (next: Section) => {
      setDrafts((prev) => ({
        ...prev,
        [activeDevice]: prev[activeDevice].map((s) => (s.id === next.id ? next : s)),
      }));
    },
    [activeDevice],
  );

  const handleReset = useCallback(async () => {
    if (
      !(await confirm({
        title: "إعادة تعيين",
        message: "سيتم تجاهل كل التعديلات غير المحفوظة وتحميل الـ layout الأصلي من السيرفر.",
        danger: true,
      }))
    )
      return;
    // Reload current device from API
    try {
      const res = await apiFetch<AdminLayoutResponse>(
        `/api/admin/home-layout?device=${activeDevice}`,
      );
      if (res.success && res.data) {
        setDrafts((prev) => ({
          ...prev,
          [activeDevice]: Array.isArray(res.data.sections) ? res.data.sections : [],
        }));
        setNames((prev) => ({ ...prev, [activeDevice]: res.data.name }));
        showToast("تم إعادة التعيين", "success");
      }
    } catch {
      showToast("فشل إعادة التعيين", "error");
    }
  }, [activeDevice, confirm, showToast]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const sections = drafts[activeDevice];
      const res = await csrfFetch(`/api/admin/home-layout?device=${activeDevice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: names[activeDevice],
          sections,
          is_active: true,
        }),
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showToast(json.error || "فشل الحفظ", "error");
        return;
      }
      showToast(`تم الحفظ — ${sections.length} قسم`, "success");
    } catch {
      showToast("فشل الحفظ", "error");
    } finally {
      setSaving(false);
    }
  }, [activeDevice, drafts, names, showToast]);

  const handlePreview = useCallback(() => {
    // Open the storefront in a new tab so the admin can see the result.
    // device detection is done client-side in DynamicHomeLayout.
    window.open("/?preview=1", "_blank");
  }, []);

  const selectedSection = useMemo(
    () => drafts[activeDevice].find((s) => s.id === selectedId) ?? null,
    [drafts, activeDevice, selectedId],
  );

  const currentSections = drafts[activeDevice];

  return (
    <div className="space-y-6">
      {/* Top toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary">تصميم الرئيسية</h1>
          <p className="text-sm text-gray-500 mt-1">
            رتّب الأقسام وتخصيصهاها للجوال والكمبيوتر. التغييرات تنعكس على الموقع والتطبيق تلقائياً.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handlePreview}>
            <Eye className="w-4 h-4 ml-1" />
            معاينة
          </Button>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 ml-1" />
            إعادة تعيين
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 ml-1" />
            )}
            حفظ
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl p-1 w-fit">
        {DEVICE_TYPES.map((device) => (
          <button
            key={device}
            type="button"
            onClick={() => {
              setActiveDevice(device);
              setSelectedId(null);
              setEditorOpen(false);
            }}
            className={[
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              activeDevice === device
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100",
            ].join(" ")}
          >
            {device === "mobile" ? (
              <Smartphone className="w-4 h-4" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
            {device === "mobile" ? "جوال" : "كمبيوتر"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 bg-white rounded-2xl border border-gray-200">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="mr-2 text-gray-500">جاري التحميل...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Center — canvas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {currentSections.length === 0
                  ? "ابدأ بإضافة قسم من اللوحة على اليمين"
                  : `${currentSections.length} قسم في الـ layout`}
              </p>
              <Link
                href={`/api/v1/home-layout?device=${activeDevice}`}
                target="_blank"
                className="text-xs text-gray-400 hover:text-primary"
              >
                عرض JSON →
              </Link>
            </div>
            <LayoutCanvas
              sections={currentSections}
              selectedId={selectedId}
              onSelect={handleSelect}
              onMove={handleMove}
              onToggleVisibility={handleToggleVisibility}
              onDelete={handleDelete}
            />
          </div>

          {/* Right — palette */}
          <aside className="bg-white rounded-2xl border border-gray-200 p-4 h-fit lg:sticky lg:top-4">
            <SectionPalette onAdd={handleAdd} />
          </aside>
        </div>
      )}

      {/* Editor drawer */}
      {editorOpen && selectedSection && (
        <EditorDrawer section={selectedSection} onChange={handleEditorChange} onClose={() => setEditorOpen(false)} />
      )}

      {confirm.dialog}
    </div>
  );
}

function EditorDrawer({
  section,
  onChange,
  onClose,
}: {
  section: Section;
  onChange: (next: Section) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true">
      <button
        type="button"
        className="flex-1 cursor-default"
        onClick={onClose}
        aria-label="إغلاق"
      />
      <div className="w-full sm:max-w-lg bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
          <p className="font-bold text-secondary">تعديل القسم</p>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <SectionEditor section={section} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}