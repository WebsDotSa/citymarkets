import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('@/lib/identity', () => ({
  requireAdminApi: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/native-push", () => ({
  isNativePushConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/twilio-messaging", () => ({
  isTwilioMessagingConfigured: vi.fn().mockReturnValue(true),
}));

import { GET } from "./route";
import { requireAdminApi } from '@/lib/identity';

function makeReq(): Request {
  return { headers: { get: () => null }, url: "http://x" } as unknown as Request;
}

describe("/api/admin/broadcast-providers/status", () => {
  beforeEach(() => {
    vi.mocked(requireAdminApi).mockResolvedValue({
      admin: { id: "admin-1", email: "x@y.z", role: "super_admin" },
    });
  });

  it("returns 5 channels with correct configured flags", async () => {
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const channels = body.data as { channel: string; configured: boolean }[];
    const byChannel = Object.fromEntries(channels.map((c) => [c.channel, c.configured]));
    expect(channels.length).toBe(5);
    expect(byChannel.email).toBe(true);
    expect(byChannel.sms).toBe(true);
    expect(byChannel.native_push).toBe(false);
    expect(byChannel.in_app).toBe(true);
    expect(typeof byChannel.web_push).toBe("boolean");
  });
});