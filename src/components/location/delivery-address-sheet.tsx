"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Check, LocateFixed, Loader2, MapPin, Pencil, Plus, X } from "lucide-react";
import {
  useDeliveryLocationState,
  useDeliveryLocationUi,
  useDeliveryLocationActions,
} from "@/contexts/delivery-location-context";
import {
  ADDRESS_LABELS,
  DEFAULT_MAP_CENTER,
  type AddressLabelType,
} from "@/lib/delivery-address";
import { reverseGeocode } from "@/lib/geocode";
import { BRAND } from "@/lib/brand-theme";
import { useToast } from "@/components/ui/toast";

const AddressMapPicker = dynamic(
  () =>
    import("@/components/location/address-map-picker").then(
      (m) => m.AddressMapPicker,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-52 rounded-2xl bg-gray-100 animate-pulse" />
    ),
  },
);

export function DeliveryAddressSheet() {
  const { sheetOpen } = useDeliveryLocationUi();
  const { addresses, selectedAddress, loading } = useDeliveryLocationState();
  const { closeSheet, openAddFlow, selectAddress, addAddress } =
    useDeliveryLocationActions();
  const { showToast } = useToast();
  const [quickMapOpen, setQuickMapOpen] = useState(false);
  const [lat, setLat] = useState(DEFAULT_MAP_CENTER.lat);
  const [lng, setLng] = useState(DEFAULT_MAP_CENTER.lng);
  const [addressText, setAddressText] = useState("");
  const [description, setDescription] = useState("");
  const [labelType, setLabelType] = useState<AddressLabelType>("home");
  const [customLabel, setCustomLabel] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sheetOpen) {
      setQuickMapOpen(false);
      setGeocoding(false);
      setLocating(false);
      setSaving(false);
    }
  }, [sheetOpen]);

  const openQuickMap = useCallback(() => {
    const selectedLat = Number(selectedAddress?.lat);
    const selectedLng = Number(selectedAddress?.lng);
    setLat(
      Number.isFinite(selectedLat) ? selectedLat : DEFAULT_MAP_CENTER.lat,
    );
    setLng(
      Number.isFinite(selectedLng) ? selectedLng : DEFAULT_MAP_CENTER.lng,
    );
    setAddressText(selectedAddress?.address_text ?? "");
    setDescription("");
    setLabelType(selectedAddress?.labelType ?? "home");
    setCustomLabel("");
    setQuickMapOpen(true);
  }, [selectedAddress]);

  const goToCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      showToast("لا يمكن الوصول إلى موقعك من هذا الجهاز", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setAddressText("");
        setLocating(false);
      },
      () => {
        setLocating(false);
        showToast("تعذّر تحديد موقعك الحالي", "error");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [showToast]);

  const resolveAddress = useCallback(async () => {
    setGeocoding(true);
    try {
      const text = await reverseGeocode(lat, lng);
      setAddressText(text);
    } finally {
      setGeocoding(false);
    }
  }, [lat, lng]);

  const handleSave = useCallback(async () => {
    let resolvedAddress = addressText.trim();
    if (!resolvedAddress) {
      setGeocoding(true);
      resolvedAddress = await reverseGeocode(lat, lng);
      setAddressText(resolvedAddress);
      setGeocoding(false);
    }
    if (!resolvedAddress) return;

    const label =
      labelType === "other" && customLabel.trim()
        ? customLabel.trim()
        : ADDRESS_LABELS.find((item) => item.type === labelType)?.label ||
          "عنوان";

    setSaving(true);
    try {
      await addAddress({
        label,
        labelType,
        lat,
        lng,
        address_text: resolvedAddress,
        description: description.trim() || undefined,
        place_images: [],
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "تعذّر حفظ العنوان. تحقق من الاتصال وحاول مجدداً",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [
    addAddress,
    addressText,
    customLabel,
    description,
    lat,
    lng,
    labelType,
    showToast,
  ]);

  if (!sheetOpen) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 bg-black/40 z-[60]"
        aria-label="إغلاق"
        onClick={closeSheet}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-3xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300 ${
          quickMapOpen ? "max-h-[92vh]" : "max-h-[75vh]"
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {quickMapOpen ? "تحديد موقع جديد" : "عنوان التوصيل"}
          </h2>
          <button
            type="button"
            onClick={closeSheet}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {quickMapOpen ? (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="relative">
              <AddressMapPicker
                lat={lat}
                lng={lng}
                onChange={(newLat, newLng) => {
                  setLat(newLat);
                  setLng(newLng);
                  setAddressText("");
                }}
                className="h-52 rounded-2xl"
              />
              <button
                type="button"
                onClick={goToCurrentLocation}
                disabled={locating}
                className="absolute bottom-3 left-3 z-[600] inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-lg disabled:opacity-60"
              >
                {locating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LocateFixed className="w-4 h-4" />
                )}
                موقعي الحالي
              </button>
            </div>

            <button
              type="button"
              onClick={resolveAddress}
              disabled={geocoding}
              className="w-full rounded-xl border border-primary/30 bg-primary-light/40 py-2.5 text-sm font-semibold text-primary disabled:opacity-60"
            >
              {geocoding ? "جاري تحديد العنوان…" : "تحديث العنوان من الخريطة"}
            </button>

            {addressText && (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {addressText}
              </p>
            )}

            <div>
              <p className="mb-2 text-sm font-bold text-gray-800">احفظه باسم</p>
              <div className="flex flex-wrap gap-2">
                {ADDRESS_LABELS.map((item) => {
                  const active = labelType === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => setLabelType(item.type)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary text-white"
                          : "border-gray-200 bg-white text-gray-700"
                      }`}
                    >
                      <span>{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {labelType === "other" && (
                <input
                  type="text"
                  value={customLabel}
                  onChange={(event) => setCustomLabel(event.target.value)}
                  placeholder="اسم التصنيف"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              )}
            </div>

            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="وصف مختصر للسائق (اختياري)"
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {loading && (
              <p className="py-8 text-center text-sm text-gray-500">
                جاري التحميل…
              </p>
            )}
            {!loading && addresses.length === 0 && (
              <div className="py-10 text-center">
                <MapPin className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                <p className="mb-1 font-medium text-gray-600">
                  لا توجد عناوين محفوظة
                </p>
                <p className="mb-4 text-sm text-gray-400">
                  أضف عنوانك لتوصيل أسرع وأدق
                </p>
              </div>
            )}
            {addresses.map((addr) => {
              const selected = selectedAddress?.id === addr.id;
              return (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() => selectAddress(addr.id)}
                  className={`w-full flex items-center gap-3 py-4 border-b border-gray-50 text-right transition-colors ${
                    selected ? "bg-primary-light/50" : ""
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      selected
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {selected ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <MapPin className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm">{addr.label}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {addr.address_text}
                    </p>
                  </div>
                  <span
                    className="text-xs text-primary flex items-center gap-1 flex-shrink-0"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    تعديل
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="p-4 border-t border-gray-100 pb-safe space-y-2">
          {quickMapOpen ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || geocoding}
                className="w-full rounded-2xl py-3.5 font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: BRAND.primary }}
              >
                {saving ? "جاري الحفظ…" : "حفظ الموقع"}
              </button>
              <button
                type="button"
                onClick={() => setQuickMapOpen(false)}
                className="w-full rounded-2xl py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50"
              >
                العودة للعناوين المحفوظة
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={openQuickMap}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary-light/30 py-3.5 font-bold text-primary"
              >
                <MapPin className="w-5 h-5" />
                تحديد على الخريطة
              </button>
              <button
                type="button"
                onClick={openAddFlow}
                className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 font-bold text-white"
                style={{ backgroundColor: BRAND.primary }}
              >
                <Plus className="w-5 h-5" />
                إضافة عنوان كامل
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
