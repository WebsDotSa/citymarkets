"use client";

import { useState, useRef } from "react";
import { Upload, X, Image as ImageIcon, Loader2, AlertCircle } from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";
import { compressImageForUpload } from "@/lib/image-compress";
import { error as logError } from "@/lib/logger";

interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  folder?: string;
  placeholder?: string;
  aspectRatio?: string;
}

export function ImageUploader({
  value,
  onChange,
  folder = "banners",
  placeholder = "اضغط لرفع صورة",
  aspectRatio = "aspect-video",
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const original = e.target.files?.[0];
    if (!original) return;

    // Validate
    if (!original.type.startsWith("image/")) {
      setError("الملف يجب أن يكون صورة");
      return;
    }
    if (original.size > 10 * 1024 * 1024) {
      setError("حجم الصورة يجب ألا يتجاوز 10 ميجابايت");
      return;
    }

    setUploading(true);
    setError("");

    try {
      // Client-side compression. Camera/HEIC exports are often 5–10 MB; a
      // phone snapshot at 4032×3024 downscaled to 1920px JPEG is typically
      // ~300 KB. The upload used to time out at 30 s for users on slow
      // connections because the original file took longer than that to
      // reach the server. Resizing in-browser before the request keeps
      // both the body and the R2 PUT cheap.
      const file = await compressImageForUpload(original);

      const formData = new FormData();
      formData.append("image", file, file.name);
      formData.append("folder", folder);

      // 120 s ceiling: most cell networks finish a 1 MB JPEG in <20 s, so
      // 120 s is generous for the slow-link case without leaving a stuck
      // request hanging indefinitely if the network actually drops.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);

      const res = await csrfFetch("/api/admin/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
        credentials: "include",
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const result = await res.json();

      if (result.success) {
        onChange(result.data.url);
        setError("");
      } else {
        setError(result.error || "فشل رفع الصورة");
      }
    } catch (err: any) {
      // Audit I39: canonical logger.
      logError("Upload error", err);
      if (err.name === "AbortError") {
        setError("انتهت مهلة الرفع. جرّب مرة أخرى.");
      } else {
        setError(err.message || "حدث خطأ أثناء الرفع");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    if (value?.startsWith("/images/")) {
      try {
        await csrfFetch(`/api/admin/upload?path=${encodeURIComponent(value)}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch (err) {
        // Audit I39: canonical logger.
        logError("Delete error", err);
      }
    }
    onChange("");
  };

  return (
    <div className="space-y-3">
      {/* Preview */}
      {value ? (
        <div className={`relative w-full ${aspectRatio} bg-gray-50 rounded-xl overflow-hidden border border-gray-200 group`}>
          <img
            src={value}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />

          {/* Overlay actions */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={handleRemove}
              className="p-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`flex flex-col items-center justify-center w-full ${aspectRatio} bg-gray-50 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            uploading
              ? "border-primary/50 bg-primary/5 cursor-not-allowed"
              : "border-gray-200 hover:border-primary/50 hover:bg-primary/5"
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
              <span className="text-sm font-medium text-primary">جاري الرفع...</span>
              <span className="text-xs text-gray-400 mt-1">يرجى الانتظار</span>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-secondary">{placeholder}</p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP • أقصى 10MB</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
        </label>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      {/* URL input fallback */}
      <div className="relative">
        <ImageIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="أو أدخل رابط الصورة مباشرة..."
          className="w-full h-10 pr-10 pl-4 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>
    </div>
  );
}
