"use client";

import { getApiErrorMessage } from "@/lib/api-error";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Loader2,
  LocateFixed,
  Plus,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useDeliveryLocationUi,
  useDeliveryLocationActions,
} from "@/contexts/delivery-location-context";
import {
  ADDRESS_LABELS,
  DEFAULT_MAP_CENTER,
  type AddressLabelType,
} from '@/lib/delivery';
import { reverseGeocode } from '@/lib/delivery';
import { csrfFetch } from "@/lib/csrf-client";
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
      <div className="min-h-[280px] bg-gray-100 animate-pulse rounded-2xl" />
    ),
  },
);

type Step = "map" | "form";

export function AddAddressFlow() {
  const { addFlowOpen } = useDeliveryLocationUi();
  const { closeAddFlow, addAddress } = useDeliveryLocationActions();
  const [step, setStep] = useState<Step>("map");
  const [lat, setLat] = useState(DEFAULT_MAP_CENTER.lat);
  const [lng, setLng] = useState(DEFAULT_MAP_CENTER.lng);
  const [addressText, setAddressText] = useState("");
  const [description, setDescription] = useState("");
  const [labelType, setLabelType] = useState<AddressLabelType>("home");
  const [customLabel, setCustomLabel] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // "Help the driver" place images
  const [placeImages, setPlaceImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!addFlowOpen) {
      setStep("map");
      setLat(DEFAULT_MAP_CENTER.lat);
      setLng(DEFAULT_MAP_CENTER.lng);
      setAddressText("");
      setDescription("");
      setLabelType("home");
      setCustomLabel("");
      setPlaceImages([]);
      setUploadError(null);
    }
  }, [addFlowOpen]);

  const goToCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (placeImages.length >= 5) {
        setUploadError("الحد الأقصى 5 صور");
        return;
      }
      if (!file.type.startsWith("image/")) {
        setUploadError("يجب أن يكون الملف صورة");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("حجم الصورة يجب ألا يتجاوز 5 ميجابايت");
        return;
      }

      setUploadingImage(true);
      setUploadError(null);
      try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await csrfFetch("/api/v1/upload/place-images", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();
        if (!json.success) {
          setUploadError(getApiErrorMessage(json, "فشل رفع الصورة"));
          return;
        }
        setPlaceImages((prev) => [...prev, json.data.url]);
      } catch (err) {
        setUploadError("فشل رفع الصورة. تحقق من الاتصال");
      } finally {
        setUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [placeImages.length],
  );

  const removeImage = useCallback(async (url: string) => {
    setPlaceImages((prev) => prev.filter((u) => u !== url));
    try {
      await csrfFetch(
        `/api/v1/upload/place-images?path=${encodeURIComponent(url)}`,
        {
          method: "DELETE",
        },
      );
    } catch {
      /* best-effort cleanup */
    }
  }, []);

  const onFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImageUpload(file);
    },
    [handleImageUpload],
  );

  const confirmMapLocation = async () => {
    setGeocoding(true);
    const text = await reverseGeocode(lat, lng);
    setAddressText(text);
    setGeocoding(false);
    setStep("form");
  };

  const handleSave = async () => {
    const label =
      labelType === "other" && customLabel.trim()
        ? customLabel.trim()
        : ADDRESS_LABELS.find((l) => l.type === labelType)?.label || "عنوان";

    if (!addressText.trim()) return;

    setSaving(true);
    try {
      await addAddress({
        label,
        labelType,
        lat,
        lng,
        address_text: addressText.trim(),
        description: description.trim() || undefined,
        place_images: placeImages,
      });
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "تعذّر حفظ العنوان. تحقق من الاتصال وحاول مجدداً",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!addFlowOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">إضافة عنوان جديد</h1>
        <button
          type="button"
          onClick={closeAddFlow}
          className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center"
          aria-label="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </header>

      {step === "map" ? (
        <>
          <div className="flex-1 relative min-h-0">
            <AddressMapPicker
              lat={lat}
              lng={lng}
              onChange={(newLat, newLng) => {
                setLat(newLat);
                setLng(newLng);
              }}
              className="absolute inset-0 rounded-none"
            />
            <button
              type="button"
              onClick={goToCurrentLocation}
              className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[600] flex items-center gap-2 bg-white px-4 py-2.5 rounded-full shadow-lg text-sm font-semibold text-gray-800"
            >
              <LocateFixed className="w-4 h-4" />
              موقعي الحالي
            </button>
          </div>
          <div className="p-4 border-t border-gray-100">
            <button
              type="button"
              disabled={geocoding}
              onClick={confirmMapLocation}
              className="w-full py-3.5 rounded-2xl font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: BRAND.primary }}
            >
              {geocoding ? "جاري تحديد العنوان…" : "تأكيد العنوان"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div>
            <div className="rounded-2xl overflow-hidden h-36 relative mb-2">
              <AddressMapPicker
                lat={lat}
                lng={lng}
                onChange={(newLat, newLng) => {
                  setLat(newLat);
                  setLng(newLng);
                }}
                className="h-full"
              />
            </div>
            <p className="text-xs text-gray-500 text-center">
              هذا هو الموقع الذي حددته ويمكنك تغييره.
            </p>
            <button
              type="button"
              onClick={() => setStep("map")}
              className="text-xs text-primary font-semibold mt-1"
            >
              تغيير
            </button>
          </div>

          <div className="border border-dashed border-primary/40 rounded-2xl p-4 bg-primary-light/30">
            <div className="flex items-start gap-2 mb-3">
              <Camera className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800 mb-1">
                  ساعد السائق في العثور عليك بشكل أسرع!
                </p>
                <p className="text-xs text-gray-500">
                  أضف صوراً للمبنى أو الباب أو أي علامة مميزة (حتى 5 صور)
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFileSelected}
              disabled={uploadingImage || placeImages.length >= 5}
            />

            {placeImages.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {placeImages.map((url) => (
                  <div
                    key={url}
                    className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 group"
                  >
                    <Image
                      src={url}
                      alt="صورة المكان"
                      fill
                      sizes="120px"
                      className="object-cover"
                      unoptimized
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(url)}
                      className="absolute top-1 left-1 w-6 h-6 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center"
                      aria-label="حذف الصورة"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {placeImages.length < 5 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="aspect-square rounded-xl border-2 border-dashed border-primary/50 flex flex-col items-center justify-center text-primary hover:bg-primary/5 disabled:opacity-50"
                    aria-label="إضافة صورة أخرى"
                  >
                    {uploadingImage ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-6 h-6" />
                        <span className="text-[10px] mt-0.5">إضافة</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-full py-3 rounded-xl border-2 border-dashed border-primary/50 text-primary text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/5 disabled:opacity-50"
              >
                {uploadingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري الرفع…
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    أضف صور للمكان
                  </>
                )}
              </button>
            )}

            {uploadError && (
              <p className="text-xs text-red-600 mt-2">{uploadError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-800 mb-2">
              وصف العنوان
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="أضف معلومات إضافية إلى السائق للمساعدة في التسليم بشكل أسرع..."
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <p className="text-sm font-bold text-gray-800 mb-2">
              اختر أحد التصنيفات
            </p>
            <div className="flex flex-wrap gap-2">
              {ADDRESS_LABELS.map((item) => {
                const active = labelType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setLabelType(item.type)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-gray-700 border-gray-200"
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
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="اسم التصنيف"
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            )}
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
            {addressText}
          </p>

          <button
            type="button"
            disabled={saving || !addressText.trim()}
            onClick={handleSave}
            className="w-full py-3.5 rounded-2xl font-bold text-white disabled:opacity-60 mb-6"
            style={{ backgroundColor: BRAND.primary }}
          >
            {saving ? "جاري الحفظ…" : "حفظ العنوان"}
          </button>
        </div>
      )}
    </div>
  );
}
