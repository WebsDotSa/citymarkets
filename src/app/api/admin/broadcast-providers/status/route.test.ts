import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('@/lib/identity', () => ({  }));
vi.mock('@/lib/identity/admin-api-auth-db', () => ({ requireAdminApi: vi.fn(), }));


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
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
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
    const channels = body.data as {
      channel: string;
      configured: boolean;
      sender_implemented?: boolean;
      detail?: string;
    }[];
    const byChannel = Object.fromEntries(channels.map((c) => [c.channel, c]));
    expect(channels.length).toBe(5);
    expect(byChannel.email.configured).toBe(true);
    expect(byChannel.sms.configured).toBe(true);
    expect(byChannel.native_push.configured).toBe(false);
    expect(byChannel.in_app.configured).toBe(true);
    expect(typeof byChannel.web_push.configured).toBe("boolean");
  });

  it("native_push channel surfaces sender_implemented + detail fields", async () => {
    const res = await GET(makeReq() as never);
    const body = await res.json();
    const native = (body.data as Array<Record<string, unknown>>).find(
      (c) => c.channel === "native_push",
    );
    expect(native).toBeDefined();
    // Both fields exist so the admin UI can render the honest stub
    // message regardless of which side of the gate the deployment
    // is on (env missing vs sender pending).
    expect(native).toHaveProperty("sender_implemented");
    expect(native).toHaveProperty("detail");
    expect(typeof native!.detail).toBe("string");
  });
});