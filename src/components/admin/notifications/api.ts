"use client";

// Tiny typed fetch wrapper for the broadcast-center admin APIs.
// Centralizes `credentials: "include"` + JSON handling so each
// tab component stays small.

import { getApiErrorMessage } from "@/lib/api-error";
import type {
  Broadcast,
  BroadcastTemplate,
  ProviderStatus,
  BroadcastMetrics,
  BroadcastChannel,
} from "./types";

const BASE = "/api/admin";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || data.success === false) {
    throw new Error(getApiErrorMessage(data, `HTTP ${res.status}`));
  }
  return data.data as T;
}

export const broadcastApi = {
  // Campaigns
  listBroadcasts: () => http<Broadcast[]>("/broadcasts"),
  getBroadcast: (id: string) => http<Broadcast>(`/broadcasts/${id}`),
  createBroadcast: (payload: Partial<Broadcast>) =>
    http<Broadcast>("/broadcasts", { method: "POST", body: JSON.stringify(payload) }),
  updateBroadcast: (id: string, payload: Partial<Broadcast>) =>
    http<Broadcast>(`/broadcasts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteBroadcast: (id: string) =>
    http<{ id: string }>(`/broadcasts/${id}`, { method: "DELETE" }),
  sendBroadcast: (id: string) =>
    http<{ status: string }>(`/broadcasts/${id}/send`, { method: "POST" }),
  cancelBroadcast: (id: string) =>
    http<{ status: string }>(`/broadcasts/${id}/cancel`, { method: "POST" }),
  broadcastMetrics: (id: string) =>
    http<BroadcastMetrics>(`/broadcasts/${id}/metrics`),
  audiencePreview: (audience: Broadcast["audience"], channels: BroadcastChannel[]) =>
    http<{ count: number; sample_user_ids: string[] }>("/broadcasts/audience-preview", {
      method: "POST",
      body: JSON.stringify({ audience, channels }),
    }),

  // Templates
  listTemplates: () => http<BroadcastTemplate[]>("/broadcast-templates"),
  createTemplate: (payload: Partial<BroadcastTemplate>) =>
    http<BroadcastTemplate>("/broadcast-templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTemplate: (id: string, payload: Partial<BroadcastTemplate>) =>
    http<BroadcastTemplate>(`/broadcast-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteTemplate: (id: string) =>
    http<{ id: string }>(`/broadcast-templates/${id}`, { method: "DELETE" }),

  // Providers
  providerStatus: () => http<ProviderStatus[]>("/broadcast-providers/status"),
};
