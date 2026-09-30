/**
 * `cn` — Tailwind classname merger.
 *
 * Extracted from `src/lib/utils.ts` (audit H32) so consumer files that
 * ONLY need `cn` don't pull in the formatter / id-generator surface.
 * Pure function — safe in client and server modules.
 *
 * Migration: importers of `cn` from `@/lib/utils` can switch to this
 * module; `@/lib/utils` re-exports `cn` for backward compatibility and
 * will continue to do so until the audit branch closes.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
