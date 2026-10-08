"use client";

import { Plus, X } from "lucide-react";
import { FormField } from "../admin-form";

interface ImagesFieldProps {
  field: FormField;
  value: unknown;
  onMultiImageUpload: (key: string, files: FileList | null) => void;
  onRemoveImage: (key: string, index?: number) => void;
}

export function ImagesField({
  field,
  value,
  onMultiImageUpload,
  onRemoveImage,
}: ImagesFieldProps) {
  const images = (value as string[]) || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((img, idx) => (
          <div
            key={idx}
            className="relative w-20 h-20 bg-gray-50 rounded-lg overflow-hidden border border-gray-200"
          >
            <img
              src={img}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => onRemoveImage(field.key, idx)}
              className="absolute top-0.5 left-0.5 p-1 bg-red-500 text-white rounded text-xs"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <label className="flex flex-col items-center justify-center w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 hover:border-gray-300 transition-colors">
          <Plus className="w-5 h-5 text-gray-400" />
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onMultiImageUpload(field.key, e.target.files)}
          />
        </label>
      </div>
      <p className="text-xs text-gray-400">اضغط لإضافة更多 صورة</p>
    </div>
  );
}
