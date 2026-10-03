"use client";

// Templates tab — list, create, edit, delete broadcast templates.
// Per-channel content is edited in a modal with sub-tabs.

import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, X, Loader2 } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { useToast, useConfirm } from "@/components/ui/toast";
import { broadcastApi } from "./api";
import {
  CHANNELS,
  VARIABLE_OPTIONS,
  type BroadcastTemplate,
  type BroadcastChannel,
} from "./types";

// data-table does not export `Column` — declare a minimal local one.
interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
  width?: string;
}

const EMPTY_TEMPLATE: Partial<BroadcastTemplate> = {
  name: "",
  description: "",
  category: "",
  channels: ["email", "web_push"],
  variables: [],
  is_active: true,
  content: {
    email: { subject: "", html: "" },
    web_push: { title: "", body: "" },
    sms: { body: "" },
    in_app: { title: "", body: "" },
  },
};

export function NotificationsTemplatesTab() {
  const [rows, setRows] = useState<BroadcastTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<BroadcastTemplate> | null>(null);
  const { showToast } = useToast();
  const ask = useConfirm();

  const reload = async () => {
    setLoading(true);
    try {
      setRows(await broadcastApi.listTemplates());
    } catch (err) {
      showToast((err as Error).message || "فشل التحميل", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const remove = async (t: BroadcastTemplate) => {
    if (
      !(await ask({
        title: "حذف القالب",
        message: `هل تريد حذف "${t.name}"؟`,
        danger: true,
        confirmLabel: "حذف",
      }))
    )
      return;
    try {
      await broadcastApi.deleteTemplate(t.id);
      showToast("تم الحذف", "success");
      void reload();
    } catch (err) {
      showToast((err as Error).message || "فشل الحذف", "error");
    }
  };

  const columns: Column<BroadcastTemplate>[] = [
    { key: "name", label: "الاسم", sortable: true },
    {
      key: "channels",
      label: "القنوات",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.channels.map((c) => (
            <span
              key={c}
              className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"
            >
              {CHANNELS.find((x) => x.value === c)?.label ?? c}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "category",
      label: "الفئة",
      render: (r) => r.category || "—",
    },
    {
      key: "is_active",
      label: "الحالة",
      render: (r) => (
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            r.is_active
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {r.is_active ? "مفعّل" : "معطّل"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
          className="admin-btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span>قالب جديد</span>
        </button>
      </div>
      <DataTable
        title="قوالب البث"
        description="قوالب جاهزة قابلة لإعادة الاستخدام عبر القنوات"
        columns={columns as never}
        data={rows as unknown as Record<string, unknown>[]}
        loading={loading}
        onRefresh={reload}
        onEdit={(t) => setEditing(t as unknown as Partial<BroadcastTemplate>)}
        onDelete={(t) => remove(t as unknown as BroadcastTemplate)}
        addLabel="قالب جديد"
        onAdd={() => setEditing({ ...EMPTY_TEMPLATE })}
      />

      {editing && (
        <TemplateEditorModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditorModal({
  template,
  onClose,
  onSaved,
}: {
  template: Partial<BroadcastTemplate>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<BroadcastTemplate>>(template);
  const [saving, setSaving] = useState(false);
  const [activeChannel, setActiveChannel] = useState<BroadcastChannel>("email");
  const { showToast } = useToast();

  const toggleChannel = (c: BroadcastChannel) => {
    const has = draft.channels?.includes(c) ?? false;
    const next = has
      ? (draft.channels ?? []).filter((x) => x !== c)
      : [...(draft.channels ?? []), c];
    setDraft({ ...draft, channels: next });
  };

  const save = async () => {
    if (!draft.name?.trim()) {
      showToast("الاسم مطلوب", "error");
      return;
    }
    if (!draft.channels?.length) {
      showToast("اختر قناة واحدة على الأقل", "error");
      return;
    }
    setSaving(true);
    try {
      if (draft.id) {
        await broadcastApi.updateTemplate(draft.id, draft);
      } else {
        await broadcastApi.createTemplate(draft);
      }
      showToast("تم الحفظ", "success");
      onSaved();
    } catch (err) {
      showToast((err as Error).message || "فشل الحفظ", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto admin-scroll">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-800">
            {draft.id ? "تعديل قالب" : "قالب جديد"}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tpl-name" className="block">
                <span className="text-sm text-gray-600">الاسم</span>
              </label>
              <input
                id="tpl-name"
                value={draft.name ?? ""}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="tpl-category" className="block">
                <span className="text-sm text-gray-600">الفئة</span>
              </label>
              <input
                id="tpl-category"
                value={draft.category ?? ""}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2"
                placeholder="ترحيب، عروض، تذكير…"
              />
            </div>
          </div>
          <div>
            <label htmlFor="tpl-description" className="block">
              <span className="text-sm text-gray-600">الوصف</span>
            </label>
            <textarea
              id="tpl-description"
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-2">القنوات</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => {
                const active = draft.channels?.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => toggleChannel(c.value)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-gray-700 border-gray-200 hover:border-primary"
                    }`}
                  >
                    {c.icon} {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-2">المتغيرات</p>
            <div className="flex flex-wrap gap-2">
              {VARIABLE_OPTIONS.map((v) => {
                const active = draft.variables?.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      const has = draft.variables?.includes(v);
                      setDraft({
                        ...draft,
                        variables: has
                          ? (draft.variables ?? []).filter((x) => x !== v)
                          : [...(draft.variables ?? []), v],
                      });
                    }}
                    className={`px-2 py-0.5 rounded text-xs font-mono border ${
                      active
                        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                        : "bg-white text-gray-600 border-gray-200"
                    }`}
                  >
                    {`{${v}}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-channel editor */}
          {draft.channels && draft.channels.length > 0 && (
            <div>
              <div className="flex gap-2 mb-3 border-b border-gray-100">
                {draft.channels.map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveChannel(c)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                      activeChannel === c
                        ? "border-primary text-primary"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {CHANNELS.find((x) => x.value === c)?.label}
                  </button>
                ))}
              </div>
              <ChannelEditor
                channel={activeChannel}
                content={draft.content ?? {}}
                onChange={(content) => setDraft({ ...draft, content })}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">
            إلغاء
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelEditor({
  channel,
  content,
  onChange,
}: {
  channel: BroadcastChannel;
  content: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const cur = (content[channel] as Record<string, string>) ?? {};
  const set = (key: string, value: string) =>
    onChange({ ...content, [channel]: { ...cur, [key]: value } });
  if (channel === "email") {
    return (
      <div className="space-y-3">
        <div>
          <label htmlFor="tpl-email-subject" className="block">
            <span className="text-sm text-gray-600">العنوان</span>
          </label>
          <input
            id="tpl-email-subject"
            value={cur.subject ?? ""}
            onChange={(e) => set("subject", e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="tpl-email-html" className="block">
            <span className="text-sm text-gray-600">HTML</span>
          </label>
          <textarea
            id="tpl-email-html"
            value={cur.html ?? ""}
            onChange={(e) => set("html", e.target.value)}
            rows={6}
            className="mt-1 w-full border rounded-lg px-3 py-2 font-mono text-xs"
          />
        </div>
      </div>
    );
  }
  if (channel === "sms") {
    return (
      <div>
        <label htmlFor="tpl-sms-body" className="block">
          <span className="text-sm text-gray-600">النص</span>
        </label>
        <textarea
          id="tpl-sms-body"
          value={cur.body ?? ""}
          onChange={(e) => set("body", e.target.value)}
          rows={3}
          className="mt-1 w-full border rounded-lg px-3 py-2"
        />
      </div>
    );
  }
  if (channel === "in_app") {
    return (
      <div className="space-y-3">
        <div>
          <label htmlFor="tpl-inapp-title" className="block">
            <span className="text-sm text-gray-600">العنوان</span>
          </label>
          <input
            id="tpl-inapp-title"
            value={cur.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="tpl-inapp-body" className="block">
            <span className="text-sm text-gray-600">النص</span>
          </label>
          <textarea
            id="tpl-inapp-body"
            value={cur.body ?? ""}
            onChange={(e) => set("body", e.target.value)}
            rows={3}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="tpl-inapp-url" className="block">
            <span className="text-sm text-gray-600">رابط (URL)</span>
          </label>
          <input
            id="tpl-inapp-url"
            value={cur.url ?? ""}
            onChange={(e) => set("url", e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder="https://citymarkets.sa/offers"
          />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="tpl-default-title" className="block">
          <span className="text-sm text-gray-600">العنوان</span>
        </label>
        <input
          id="tpl-default-title"
          value={cur.title ?? ""}
          onChange={(e) => set("title", e.target.value)}
          className="mt-1 w-full border rounded-lg px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="tpl-default-body" className="block">
          <span className="text-sm text-gray-600">النص</span>
        </label>
        <textarea
          id="tpl-default-body"
          value={cur.body ?? ""}
          onChange={(e) => set("body", e.target.value)}
          rows={3}
          className="mt-1 w-full border rounded-lg px-3 py-2"
        />
      </div>
    </div>
  );
}
