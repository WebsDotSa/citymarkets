"use client";

/**
 * Compatibility no-op for the legacy jQuery Select2 bootstrap hook.
 *
 * `Select2Field` now renders the React-native `SearchableSelect` directly
 * (no DOM <select> underneath, no jQuery required), so this hook no longer
 * needs to attach anything. It stays exported because
 * `src/components/admin/admin-form.tsx` still calls it — the wrapper is
 * kept to preserve the import surface and signature.
 */
import { useRef } from "react";
import { FormField } from "../admin-form";

export function useSelect2Init(
  _fields: FormField[],
  _onSelect2Change: (key: string, value: unknown) => void,
) {
  return useRef<Record<string, unknown>>({});
}