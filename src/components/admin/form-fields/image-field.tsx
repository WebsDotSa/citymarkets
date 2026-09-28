"use client";

import { Trash2, Upload } from "lucide-react";
import { FormField } from "../admin-form";

interface ImageFieldProps {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  onImageUpload: (key: string, files: FileList | null) => void;
  onRemoveImage: (key: string, index?: number) => void;
}

export function ImageField({
  field,
  value,
  onChange,
  onImageUpload,
  onRemoveImage,
}: ImageFieldProps) {
  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative w-full h-40 bg-slate-50 rounded-xl overflow-hidden border-2 border-slate-200">
          <img
            src={value as string}
            alt=""
            className="w-full h-full object-contain"
          />
          <button
            type="button"
            onClick={() => onRemoveImage(field.key)}
            className="absolute top-2 left-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-lg"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-32 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 hover:border-slate-300 transition-colors">
          <Upload className="w-6 h-6 text-slate-400 mb-2" />
          <p className="text-xs text-slate-500">اضغط لرفع صورة</p>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onImageUpload(field.key, e.target.files)}
          />
        </label>
      )}
      <input
        type="text"
        data-field={field.key}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder="أو أدخل رابط الصورة"
        className="admin-input text-sm"
      />
    </div>
  );
}
