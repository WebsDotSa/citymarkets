"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuthState } from "@/contexts/auth-context";
import { csrfFetch } from "@/lib/csrf-client";
import type { AddressLabelType, DeliveryAddress } from '@/lib/delivery';
import {
  getOrCreateGuestKey,
  getSelectedAddressId,
  loadLocalAddresses,
  saveLocalAddresses,
  setSelectedAddressId,
} from '@/lib/delivery';

type DeliveryLocationState = {
  addresses: DeliveryAddress[];
  selectedAddress: DeliveryAddress | null;
  loading: boolean;
};

type DeliveryLocationUiState = {
  sheetOpen: boolean;
  addFlowOpen: boolean;
};

type DeliveryLocationActions = {
  openSheet: () => void;
  closeSheet: () => void;
  openAddFlow: () => void;
  closeAddFlow: () => void;
  selectAddress: (id: string) => void;
  addAddress: (
    input: Omit<DeliveryAddress, "id" | "is_default">,
  ) => Promise<void>;
  updateAddress: (
    id: string,
    input: Omit<DeliveryAddress, "id">,
  ) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  refreshAddresses: () => Promise<void>;
};

type DeliveryLocationContextType = DeliveryLocationState &
  DeliveryLocationUiState &
  DeliveryLocationActions;

const DeliveryLocationStateContext =
  createContext<DeliveryLocationState | null>(null);
const DeliveryLocationUiContext = createContext<DeliveryLocationUiState | null>(
  null,
);
const DeliveryLocationActionsContext =
  createContext<DeliveryLocationActions | null>(null);
const DeliveryLocationContext =
  createContext<DeliveryLocationContextType | null>(null);

function rowToAddress(row: Record<string, unknown>): DeliveryAddress {
  return {
    id: String(row.id),
    label: String(row.label),
    labelType: "other",
    lat: Number(row.lat) || 0,
    lng: Number(row.lng) || 0,
    address_text: String(row.address_text),
    description: row.description ? String(row.description) : undefined,
    place_images: Array.isArray(row.place_images)
      ? (row.place_images as unknown[]).filter(
          (u): u is string => typeof u === "string",
        )
      : [],
    is_default: Boolean(row.is_default),
  };
}

function addressFetchInit(
  isLoggedIn: boolean,
  guestKey: string,
  init?: RequestInit,
): RequestInit {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isLoggedIn) {
    return { ...init, credentials: "include", headers };
  }
  headers.set("x-guest-key", guestKey);
  return { ...init, credentials: "include", headers };
}

export function DeliveryLocationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuthState();
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);
  const [guestKey, setGuestKey] = useState("");

  useEffect(() => {
    setGuestKey(getOrCreateGuestKey());
    setSelectedId(getSelectedAddressId());
  }, []);

  const syncFromServer = useCallback(async () => {
    if (!guestKey && !user?.id) return false;
    try {
      const res = await fetch("/api/v1/delivery-addresses", {
        ...addressFetchInit(Boolean(user?.id), guestKey),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        const mapped = json.data.map(rowToAddress);
        setAddresses(mapped);
        saveLocalAddresses(mapped);
        const def =
          mapped.find((a: DeliveryAddress) => a.is_default) || mapped[0];
        const stored = getSelectedAddressId();
        const pick =
          stored && mapped.some((a: DeliveryAddress) => a.id === stored)
            ? stored
            : def.id;
        setSelectedId(pick);
        setSelectedAddressId(pick);
        return true;
      }
    } catch {
      /* use local */
    }
    return false;
  }, [guestKey, user?.id]);

  const refreshAddresses = useCallback(async () => {
    setLoading(true);
    const fromServer = await syncFromServer();
    if (!fromServer) {
      const local = loadLocalAddresses();
      setAddresses(local);
      if (local.length > 0) {
        const stored = getSelectedAddressId();
        const pick =
          stored && local.some((a) => a.id === stored)
            ? stored
            : local.find((a) => a.is_default)?.id || local[0].id;
        setSelectedId(pick);
      }
    }
    setLoading(false);
  }, [syncFromServer]);

  useEffect(() => {
    if (guestKey) void refreshAddresses();
  }, [guestKey, user?.id, refreshAddresses]);

  const selectAddress = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedAddressId(id);
    setSheetOpen(false);
  }, []);

  const addAddress = useCallback(
    async (input: Omit<DeliveryAddress, "id" | "is_default">) => {
      const payload = {
        label: input.label,
        lat: input.lat,
        lng: input.lng,
        address_text: input.address_text,
        description: input.description,
        place_images: input.place_images || [],
        is_default: addresses.length === 0,
      };

      const isLoggedIn = Boolean(user?.id);
      let newAddr: DeliveryAddress | null = null;

      try {
        const res = await csrfFetch("/api/v1/delivery-addresses", {
          ...addressFetchInit(isLoggedIn, guestKey),
          method: "POST",
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success && json.data) {
          newAddr = rowToAddress(json.data);
          newAddr.labelType = input.labelType;
        } else if (isLoggedIn) {
          throw new Error(json.error || "تعذّر حفظ العنوان");
        }
      } catch (err) {
        if (isLoggedIn) {
          throw err instanceof Error
            ? err
            : new Error("تعذّر حفظ العنوان. تحقق من الاتصال وحاول مجدداً");
        }
      }

      if (!newAddr) {
        newAddr = {
          ...input,
          id: `local_${Date.now()}`,
          is_default: payload.is_default,
        };
      }

      const next = [
        ...addresses.map((a) => ({ ...a, is_default: false })),
        { ...newAddr, is_default: payload.is_default },
      ];
      setAddresses(next);
      saveLocalAddresses(next);
      selectAddress(newAddr.id);
      setAddFlowOpen(false);
    },
    [addresses, guestKey, user?.id, selectAddress],
  );

  const updateAddress = useCallback(
    async (id: string, input: Omit<DeliveryAddress, "id">) => {
      const payload = {
        label: input.label,
        lat: input.lat,
        lng: input.lng,
        address_text: input.address_text,
        description: input.description,
        place_images: input.place_images || [],
        is_default: input.is_default,
      };
      const isLoggedIn = Boolean(user?.id);
      const localOnly = id.startsWith("local_");

      if (localOnly) {
        const next = addresses.map((a) => {
          if (a.id === id) {
            return { ...a, ...input };
          }
          return payload.is_default ? { ...a, is_default: false } : a;
        });
        setAddresses(next);
        saveLocalAddresses(next);
        if (payload.is_default) selectAddress(id);
        return;
      }

      try {
        const res = await csrfFetch(`/api/v1/delivery-addresses?id=${id}`, {
          ...addressFetchInit(isLoggedIn, guestKey),
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || "تعذّر تعديل العنوان");
        }
        const mapped = rowToAddress(json.data);
        mapped.labelType = input.labelType;
        const next = addresses.map((a) => {
          if (a.id === id) return mapped;
          return payload.is_default ? { ...a, is_default: false } : a;
        });
        setAddresses(next);
        saveLocalAddresses(next);
        if (payload.is_default) selectAddress(id);
      } catch (err) {
        throw err instanceof Error
          ? err
          : new Error("تعذّر تعديل العنوان. تحقق من الاتصال وحاول مجدداً");
      }
    },
    [addresses, guestKey, user?.id, selectAddress],
  );

  const removeAddress = useCallback(
    async (id: string) => {
      try {
        await csrfFetch(`/api/v1/delivery-addresses?id=${id}`, {
          ...addressFetchInit(Boolean(user?.id), guestKey),
          method: "DELETE",
        });
      } catch {
        /* local only */
      }
      const next = addresses.filter((a) => a.id !== id);
      setAddresses(next);
      saveLocalAddresses(next);
      if (selectedId === id) {
        const fallback = next[0]?.id ?? null;
        setSelectedId(fallback);
        if (fallback) setSelectedAddressId(fallback);
      }
    },
    [addresses, guestKey, selectedId, user?.id],
  );

  const selectedAddress = useMemo(
    () => addresses.find((a) => a.id === selectedId) ?? null,
    [addresses, selectedId],
  );

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const openAddFlow = useCallback(() => {
    setSheetOpen(false);
    setAddFlowOpen(true);
  }, []);
  const closeAddFlow = useCallback(() => setAddFlowOpen(false), []);

  const stateValue = useMemo<DeliveryLocationState>(
    () => ({ addresses, selectedAddress, loading }),
    [addresses, selectedAddress, loading],
  );

  const uiValue = useMemo<DeliveryLocationUiState>(
    () => ({ sheetOpen, addFlowOpen }),
    [sheetOpen, addFlowOpen],
  );

  const actionsValue = useMemo<DeliveryLocationActions>(
    () => ({
      openSheet,
      closeSheet,
      openAddFlow,
      closeAddFlow,
      selectAddress,
      addAddress,
      updateAddress,
      removeAddress,
      refreshAddresses,
    }),
    [
      openSheet,
      closeSheet,
      openAddFlow,
      closeAddFlow,
      selectAddress,
      addAddress,
      updateAddress,
      removeAddress,
      refreshAddresses,
    ],
  );

  const combinedValue = useMemo<DeliveryLocationContextType>(
    () => ({ ...stateValue, ...uiValue, ...actionsValue }),
    [stateValue, uiValue, actionsValue],
  );

  return (
    <DeliveryLocationActionsContext.Provider value={actionsValue}>
      <DeliveryLocationStateContext.Provider value={stateValue}>
        <DeliveryLocationUiContext.Provider value={uiValue}>
          <DeliveryLocationContext.Provider value={combinedValue}>
            {children}
          </DeliveryLocationContext.Provider>
        </DeliveryLocationUiContext.Provider>
      </DeliveryLocationStateContext.Provider>
    </DeliveryLocationActionsContext.Provider>
  );
}

export function useDeliveryLocationState(): DeliveryLocationState {
  const ctx = useContext(DeliveryLocationStateContext);
  if (!ctx) {
    throw new Error(
      "useDeliveryLocationState must be used within DeliveryLocationProvider",
    );
  }
  return ctx;
}

export function useDeliveryLocationUi(): DeliveryLocationUiState {
  const ctx = useContext(DeliveryLocationUiContext);
  if (!ctx) {
    throw new Error(
      "useDeliveryLocationUi must be used within DeliveryLocationProvider",
    );
  }
  return ctx;
}

export function useDeliveryLocationActions(): DeliveryLocationActions {
  const ctx = useContext(DeliveryLocationActionsContext);
  if (!ctx) {
    throw new Error(
      "useDeliveryLocationActions must be used within DeliveryLocationProvider",
    );
  }
  return ctx;
}

/**
 * @deprecated Prefer the split delivery location hooks for new code.
 */
export function useDeliveryLocation(): DeliveryLocationContextType {
  const ctx = useContext(DeliveryLocationContext);
  if (!ctx) {
    throw new Error(
      "useDeliveryLocation must be used within DeliveryLocationProvider",
    );
  }
  return ctx;
}

export type { AddressLabelType, DeliveryAddress };
