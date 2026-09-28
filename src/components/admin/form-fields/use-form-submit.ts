"use client";

import { FormField } from "./form-field";

export function useFormSubmit(
  formData: Record<string, unknown>,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  onSubmit: (data: Record<string, unknown>) => Promise<void>
) {
  return async (e: React.FormEvent, fields: FormField[]) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.required) {
        const value = formData[f.key];
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          newErrors[f.key] = "هذا الحقل مطلوب";
        }
      }
      if (f.validate) {
        const error = f.validate(formData[f.key]);
        if (error) {
          newErrors[f.key] = error;
        }
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorKey = Object.keys(newErrors)[0];
      const element = document.querySelector(`[data-field="${firstErrorKey}"]`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    await onSubmit(formData);
  };
}
