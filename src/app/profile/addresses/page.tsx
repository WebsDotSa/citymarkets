"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  MapPin,
  Plus,
  Edit3,
  Trash2,
  Home,
  Briefcase,
  Heart,
  X,
  Check,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { PageContainer } from "@/components/ui/page-container";
import {
  useDeliveryLocationState,
  useDeliveryLocationActions,
} from "@/contexts/delivery-location-context";
import { BRAND } from "@/lib/brand-theme";
import { useBrandColorVars } from "@/hooks/use-color-vars";
import type { AddressLabelType, DeliveryAddress } from '@/lib/delivery';
import { ADDRESS_LABELS } from '@/lib/delivery';

const LABEL_OPTIONS: { value: AddressLabelType; label: string; icon: typeof Home }[] = [
  { value: "home", label: "المنزل", icon: Home },
  { value: "work", label: "العمل", icon: Briefcase },
  { value: "rest", label: "الاستراحة", icon: Heart },
  { value: "other", label: "أخرى", icon: MapPin },
];

const LABELS_DISPLAY: Record<AddressLabelType, string> = ADDRESS_LABELS.reduce(
  (acc, l) => ({ ...acc, [l.type]: l.label }),
  {} as Record<AddressLabelType, string>
);

export default function AddressesPage() {
  const { addresses, selectedAddress, loading } = useDeliveryLocationState();
  const {
    selectAddress,
    openAddFlow,
    updateAddress,
    removeAddress,
  } = useDeliveryLocationActions();

  const [editing, setEditing] = useState<DeliveryAddress | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const colorVars = useBrandColorVars();

  return (
    <div style={colorVars}>
      <PageContainer width="narrow" padding="normal" className="py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">عناويني</h1>

      {loading && (
        <p className="text-sm text-gray-500 text-center py-8">جاري التحميل…</p>
      )}

      {!loading && addresses.length === 0 && (
        <div className="text-center py-12">
          <MapPin className="w-14 h-14 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 mb-4">لم تُضف أي عناوين بعد</p>
          <button
            type="button"
            onClick={openAddFlow}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-4 h-4" />
            إضافة عنوان
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {addresses.map((addr) => {
          const Icon =
            LABEL_OPTIONS.find((l) => l.value === addr.labelType)?.icon ||
            MapPin;
          return (
            <li
              key={addr.id}
              className={`rounded-2xl border p-4 ${
                selectedAddress?.id === addr.id
                  ? "border-primary bg-primary-light/40"
                  : "border-gray-100 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--primary-light)' }}
                  >
                    <Icon
                      className="w-5 h-5"
                      style={{ color: 'var(--primary)' }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-900">
                        {addr.label || LABELS_DISPLAY[addr.labelType] || "عنوان"}
                      </p>
                      {selectedAddress?.id === addr.id && (
                        <span className="text-xs text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                          الافتراضي
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1 break-words">
                      {addr.address_text}
                    </p>
                    {addr.description && (
                      <p className="text-xs text-gray-400 mt-1">
                        {addr.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {selectedAddress?.id !== addr.id && (
                  <button
                    type="button"
                    onClick={() => selectAddress(addr.id)}
                    className="text-sm text-primary font-medium hover:underline"
                  >
                    استخدام هذا العنوان
                  </button>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setEditing(addr)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-gray-700 hover:bg-gray-100"
                  aria-label="تعديل العنوان"
                >
                  <Edit3 className="w-4 h-4" />
                  تعديل
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingId(addr.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-red-600 hover:bg-red-50"
                  aria-label="حذف العنوان"
                >
                  <Trash2 className="w-4 h-4" />
                  حذف
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {addresses.length > 0 && (
        <button
          type="button"
          onClick={openAddFlow}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-primary text-primary font-semibold"
        >
          <Plus className="w-5 h-5" />
          إضافة عنوان جديد
        </button>
      )}

      <Link
        href="/profile"
        className="block text-center text-sm text-gray-500 mt-8 hover:text-primary"
      >
        العودة للملف الشخصي
      </Link>

      {editing && (
        <EditAddressDialog
          address={editing}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await updateAddress(editing.id, payload);
            setEditing(null);
          }}
          onDelete={async () => {
            await removeAddress(editing.id);
            setEditing(null);
          }}
        />
      )}

      {deletingId && (
        <ConfirmDeleteDialog
          address={addresses.find((a) => a.id === deletingId) || null}
          onCancel={() => setDeletingId(null)}
          onConfirm={async () => {
            await removeAddress(deletingId);
            setDeletingId(null);
          }}
        />
      )}

      {/* Hidden: hand off to the existing add-flow modal mounted elsewhere */}
      <AddFlowMount />
      </PageContainer>
    </div>
  );
}

/**
 * Mount dialogs into `document.body` so they escape any parent that has
 * `transform`, `filter`, or `overflow: hidden` (the previous layout had
 * `overflow` clipping that hid the bottom sheet behind the bottom nav
 * and made z-index unreliable).
 */
function useModalPortal(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setEl(document.body);
  }, []);
  return el;
}

function EditAddressDialog({
  address,
  onClose,
  onSave,
  onDelete,
}: {
  address: DeliveryAddress;
  onClose: () => void;
  onSave: (payload: Omit<DeliveryAddress, "id">) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [label, setLabel] = useState(address.label || "");
  const [labelType, setLabelType] = useState<AddressLabelType>(address.labelType);
  const [addressText, setAddressText] = useState(address.address_text || "");
  const [description, setDescription] = useState(address.description || "");
  const [isDefault, setIsDefault] = useState(Boolean(address.is_default));
  const portalEl = useModalPortal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLabel(address.label || "");
    setLabelType(address.labelType);
    setAddressText(address.address_text || "");
    setDescription(address.description || "");
    setIsDefault(Boolean(address.is_default));
  }, [address]);

  const submit = async () => {
    if (!addressText.trim()) {
      setError("العنوان مطلوب");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        label: label.trim() || LABELS_DISPLAY[labelType],
        labelType,
        lat: address.lat,
        lng: address.lng,
        address_text: addressText.trim(),
        description: description.trim() || undefined,
        place_images: address.place_images,
        is_default: isDefault,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">تعديل العنوان</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              نوع العنوان
            </label>
            <div className="grid grid-cols-4 gap-2">
              {LABEL_OPTIONS.map((opt) => {
                const OptIcon = opt.icon;
                const active = labelType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLabelType(opt.value)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-gray-100 hover:border-gray-200"
                    }`}
                  >
                    <OptIcon
                      className="w-5 h-5"
                      style={{ color: active ? 'var(--primary)' : "#6B7280" }}
                    />
                    <span
                      className="text-xs"
                      style={{ color: active ? 'var(--primary)' : "#6B7280" }}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              اسم مخصص (اختياري)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={LABELS_DISPLAY[labelType]}
              className="w-full h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              العنوان
            </label>
            <textarea
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              وصف (اختياري)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: بجانب البقالة، الدور الثاني"
              className="w-full h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-gray-700">اجعله العنوان الافتراضي</span>
          </label>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl text-red-600 font-semibold hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-gray-700 font-semibold hover:bg-gray-100"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {busy ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                حفظ
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return portalEl ? createPortal(dialog, portalEl) : null;
}

function ConfirmDeleteDialog({
  address,
  onCancel,
  onConfirm,
}: {
  address: DeliveryAddress | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const portalEl = useModalPortal();
  if (!address) return null;
  const dialog = (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full max-w-sm rounded-3xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">حذف العنوان؟</h2>
        </div>
        <p className="text-sm text-gray-600 mb-1">{address.label}</p>
        <p className="text-sm text-gray-500 mb-5">{address.address_text}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-gray-700 font-semibold hover:bg-gray-100"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-red-600 disabled:opacity-50"
          >
            {busy ? "جاري الحذف…" : "حذف"}
          </button>
        </div>
      </div>
    </div>
  );

  return portalEl ? createPortal(dialog, portalEl) : null;
}

/** Placeholder kept for symmetry with the layout; the global AddAddressFlow
 *  modal is mounted by `LocationOverlays` (triggered via the location context's
 *  `openAddFlow()`). Buttons in this page call that directly, so no extra
 *  mount is needed here. */
function AddFlowMount() {
  return null;
}
