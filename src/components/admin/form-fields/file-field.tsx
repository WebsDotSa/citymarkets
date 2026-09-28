"use client";

import { Upload } from "lucide-react";
import { FormField } from "../admin-form";

interface FileFieldProps {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export function FileField({ field, value, onChange }: FileFieldProps) {
  return (
    <label className="flex flex-col items-center justify-center w-full h-24 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 hover:border-slate-300 transition-colors">
      <Upload className="w-6 h-6 text-slate-400 mb-2" />
      <p className="text-xs text-slate-500">
        {value ? "تم اختيار ملف" : "اضغط لرفع ملف"}
      </p>
      <input
        type="file"
        accept={field.accept}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            onChange(field.key, e.target.files[0].name);
          }
        }}
      />
    </label>
  );
}
