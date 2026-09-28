import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

const mockCreateClient = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL)) {
    process.env[k] = v;
  }
  mockCreateClient.mockReset();
});

describe("supabase client initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateClient.mockReset();
  });

  it("calls createClient with the url, anon key, and autoRefreshToken options", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    mockCreateClient.mockReturnValueOnce({ auth: {} });

    await import("./client");

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = mockCreateClient.mock.calls[0];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("anon-key");
    expect(opts).toMatchObject({
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    });
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    await expect(import("./client")).rejects.toThrow(
      /Supabase environment variables/,
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(import("./client")).rejects.toThrow(
      /Supabase environment variables/,
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
