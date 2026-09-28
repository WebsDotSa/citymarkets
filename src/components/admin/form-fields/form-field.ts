"use client";

export interface FormField {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "textarea"
    | "select"
    | "select2"
    | "multiselect"
    | "image"
    | "images"
    | "checkbox"
    | "password"
    | "email"
    | "tel"
    | "color"
    | "date"
    | "time"
    | "datetime"
    | "editor"
    | "file"
    | "switch"
    | "hidden";
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  help?: string;
  colSpan?: 1 | 2;
  defaultValue?: unknown;
  disabled?: boolean;
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
  maxLength?: number;
  rows?: number;
  searchable?: boolean;
  allowClear?: boolean;
  onChange?: (value: unknown, key: string) => void;
  className?: string;
  validate?: (value: unknown) => string | null;
}
