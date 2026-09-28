"use client";

import { FormField } from "../admin-form";

interface HiddenFieldProps {
  field: FormField;
  value: unknown;
}

export function HiddenField({ field, value }: HiddenFieldProps) {
  return (
    <input
      type="hidden"
      name={field.key}
      value={String(value ?? "")}
    />
  );
}
