"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Fires `onOutside` when a pointer event happens outside the referenced
 * element. Used by dropdowns, popovers, and dismissible panels to close
 * themselves when the user clicks elsewhere.
 *
 * Pass `enabled = false` to temporarily detach the listener without
 * removing the ref.
 *
 * `onOutside` and `ref` are stored in refs so listeners are only attached
 * once per `enabled` toggle — consumers may pass inline arrow functions
 * without triggering re-binding on every render.
 *
 * @example
 *   const ref = useRef<HTMLDivElement>(null);
 *   useClickOutside(ref, () => setOpen(false));
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: (event: MouseEvent | TouchEvent) => void,
  enabled: boolean = true
): void {
  const handlerRef = useRef(onOutside);
  handlerRef.current = onOutside;

  const refRef = useRef(ref);
  refRef.current = ref;

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: MouseEvent | TouchEvent) => {
      const el = refRef.current.current;
      if (!el || el.contains(event.target as Node)) return;
      handlerRef.current(event);
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [enabled]);
}