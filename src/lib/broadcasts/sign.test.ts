import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

describe("broadcasts/sign HMAC", () => {
  beforeEach(() => {
    process.env.BROADCAST_TRACK_SECRET = "test-secret";
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
  });

  it("round-trips a valid token", async () => {
    const { signDeliveryToken, verifyDeliveryToken } = await import("./sign");
    const tok = signDeliveryToken("d1");
    const v = verifyDeliveryToken(tok);
    expect(v?.deliveryId).toBe("d1");
    expect(typeof v?.exp).toBe("number");
  });

  it("rejects tampered signature", async () => {
    const { signDeliveryToken, verifyDeliveryToken } = await import("./sign");
    const tok = signDeliveryToken("d1");
    const [p, s] = tok.split(".");
    // flip last char
    const tampered = `${p}.${s.slice(0, -1)}X`;
    expect(verifyDeliveryToken(tampered)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    vi.useFakeTimers();
    const { signDeliveryToken, verifyDeliveryToken } = await import("./sign");
    const tok = signDeliveryToken("d1", 1000);
    vi.advanceTimersByTime(2000);
    expect(verifyDeliveryToken(tok)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects malformed input", async () => {
    const { verifyDeliveryToken } = await import("./sign");
    expect(verifyDeliveryToken("nope")).toBeNull();
    expect(verifyDeliveryToken("a.b")).toBeNull();
    expect(verifyDeliveryToken("a.b.c")).toBeNull();
  });

  it("uses fallback secret when env missing (dev only)", async () => {
    delete process.env.BROADCAST_TRACK_SECRET;
    const { signDeliveryToken, verifyDeliveryToken } = await import("./sign");
    const tok = signDeliveryToken("d1");
    expect(verifyDeliveryToken(tok)?.deliveryId).toBe("d1");
  });
});