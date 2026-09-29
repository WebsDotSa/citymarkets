/**
 * Shared logic for the customer direct-order detail + chat pages.
 *
 * Background (P3-3 audit 2026-09-29): both
 *   `src/components/pages/direct-order/order-detail-client.tsx`
 *   `src/components/pages/direct-order/direct-order-chat-page.tsx`
 * were near-identical copies of:
 *   - the `OrderDetail` / `OrderItem` types
 *   - the polling `fetchOrder` effect
 *   - the `addItem` / `removeItem` mutation helpers
 *
 * They diverged in two minor ways:
 *   - `order-detail-client.tsx` also tracked `chat?.unread` count.
 *   - `removeItem` in the chat page skipped the response-success check.
 *
 * This module exposes:
 *   - the canonical `OrderDetail` / `OrderItem` types
 *   - a `useOrderPolling` hook that drives the fetch + setInterval loop
 *   - `addOrderItem` / `removeOrderItem` async helpers
 *
 * Consumers compose these with their own additional state (e.g. the
 * chat page wires its own unread counter; the detail page wires its
 * own timeline).
 *
 * Server-only contract: helpers hit `/api/v1/orders/[id]` and
 * `/api/v1/orders/[id]/items` which require the order ownership cookie
 * session. Both client pages already pass `credentials: 'include'`.
 */
"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export interface OrderAddress {
  label: string;
  text: string;
  lat?: number | null;
  lng?: number | null;
  plus_code?: string | null;
  description?: string | null;
  place_images?: string[];
  city?: string | null;
  district?: string | null;
}

export interface OrderDirectMeta {
  customer_edited: boolean;
  last_edited_at?: string | null;
  fee_acknowledged: boolean;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  type: "catalog" | "direct";
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  payment_status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  scheduled?: boolean;
  scheduled_for?: string | null;
  slot_window?: string | null;
  voice_note_url?: string | null;
  voice_note_duration?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  address: OrderAddress;
  direct_meta?: OrderDirectMeta | null;
}

export interface OrderItem {
  id: string;
  product_id?: string | null;
  name_ar?: string | null;
  image_url?: string | null;
  price?: number | null;
  free_text?: string | null;
  quantity: number;
  unit_price: number;
  notes?: string | null;
  resolved_price?: number | null;
}

// ── Polling hook ────────────────────────────────────────────────────────

export interface UseOrderPollingOptions {
  /**
   * Polling interval in ms. Default 12s. The chat page historically
   * polled at 15s; the detail page at 12s. Callers should pick based
   * on how chatty the page is.
   */
  intervalMs?: number;
  /**
   * Called after every successful fetch. Lets consumers update
   * unrelated state (e.g. unread chat counter).
   */
  onFetched?: (data: { order: OrderDetail; items: OrderItem[]; raw: unknown }) => void;
}

export interface UseOrderPollingResult {
  order: OrderDetail | null;
  items: OrderItem[];
  loading: boolean;
  error: string | null;
  /** Surface a UI error that the consumer wants to keep sticky across polls. */
  setError: (msg: string | null) => void;
  /** Force re-fetch (e.g. after a mutation). */
  refetch: () => Promise<void>;
}

/**
 * Drive the `/api/v1/orders/[id]` poll loop for a direct-order page.
 * Returns the current order + items + an explicit `refetch` for
 * consumers to call after add/remove mutations.
 */
export function useOrderPolling(
  orderId: string,
  options: UseOrderPollingOptions = {},
): UseOrderPollingResult {
  const { intervalMs = 12000, onFetched } = options;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/orders/${orderId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "فشل التحميل");
      setOrder(data.order);
      setItems(data.items || []);
      onFetched?.({ order: data.order, items: data.items || [], raw: data });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId, onFetched]);

  useEffect(() => {
    void fetchOrder();
    const t = setInterval(fetchOrder, intervalMs);
    return () => clearInterval(t);
  }, [fetchOrder, intervalMs]);

  return { order, items, loading, error, setError, refetch: fetchOrder };
}

// ── Mutation helpers ────────────────────────────────────────────────────

export interface AddOrderItemArgs {
  orderId: string;
  freeText: string;
  quantity: number;
}

export interface AddOrderItemResult {
  success: boolean;
  error?: string;
}

/**
 * POST a free-text item to a direct order.
 * Returns `{ success: true }` on 2xx-with-`success=true`, otherwise
 * `{ success: false, error }` so the caller can show a toast without
 * having to handle thrown errors.
 */
export async function addOrderItem(
  args: AddOrderItemArgs,
): Promise<AddOrderItemResult> {
  try {
    const res = await fetch(`/api/v1/orders/${args.orderId}/items`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        free_text: args.freeText,
        quantity: args.quantity,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "فشل الإضافة" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export interface RemoveOrderItemArgs {
  orderId: string;
  itemId: string;
}

export interface RemoveOrderItemResult {
  success: boolean;
  error?: string;
}

/**
 * DELETE an item from a direct order.
 * Caller is responsible for the user-facing confirm() dialog.
 */
export async function removeOrderItem(
  args: RemoveOrderItemArgs,
): Promise<RemoveOrderItemResult> {
  try {
    const res = await fetch(
      `/api/v1/orders/${args.orderId}/items?itemId=${encodeURIComponent(args.itemId)}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!data.success) {
      return { success: false, error: data.error || "فشل الحذف" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
