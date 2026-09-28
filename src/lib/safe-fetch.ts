/**
 * Abort-safe fetch wrapper used by admin list/load functions.
 *
 * The `signal?.aborted` guards suppress two unwanted behaviours:
 *  - `console.error` on AbortError (expected when a component unmounts)
 *    or on a deliberate React effect cleanup.
 *  - state updates on unmounted components.
 *
 * Callers still own their own `setLoading` lifecycle and the per-shape
 * state setters inside the body — only the boilerplate is collapsed.
 */
import { warn as logWarn, error as logError } from "@/lib/logger";

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export type SafeFetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; body: unknown }
  | null;

export async function safeFetchJson<T = unknown>(
  url: string,
  init?: RequestInit & { signal?: AbortSignal }
): Promise<T | null> {
  const signal = init?.signal;
  try {
    const res = await fetch(url, init);
    if (signal?.aborted) return null;
    return (await res.json()) as T;
  } catch (e) {
    if (!signal?.aborted) logError("safeFetchJson network error", e, { url });
    return null;
  }
}

export async function safeFetchJsonStrict<T = unknown>(
  url: string,
  init?: RequestInit & { signal?: AbortSignal }
): Promise<SafeFetchResult<T>> {
  const signal = init?.signal;
  try {
    const res = await fetch(url, init);
    if (signal?.aborted) return null;
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, data: body as T, status: res.status };
    return { ok: false, status: res.status, body };
  } catch (e) {
    if (!signal?.aborted) logWarn("safeFetchJsonStrict fetch failed", { url });
    return null;
  }
}
