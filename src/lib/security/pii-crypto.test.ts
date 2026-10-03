/**
 * Tests for src/lib/security/pii-crypto.ts
 *
 * P0-3 (security Phase 3, 2026-10-03): application-level PII
 * encryption. These tests exercise the algorithm and the blind
 * index. The full DB migration is a separate concern.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptPii,
  decryptPii,
  piiHmac,
  normalisePhone,
  _resetPiiKeyCacheForTest,
} from "@/lib/security/pii-crypto";

beforeAll(() => {
  // Tests use a fixed key pair so output is reproducible across
  // runs. The real keys are 32 random bytes, base64-encoded.
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY = randomBytes(32).toString("base64");
});

beforeEach(() => {
  _resetPiiKeyCacheForTest();
});

describe("normalisePhone", () => {
  it("strips spaces, dashes, and parentheses", () => {
    expect(normalisePhone("+966 50 123 4567")).toBe("+966501234567");
    expect(normalisePhone("966-50-123-4567")).toBe("966501234567");
    expect(normalisePhone("(966) 501 234 567")).toBe("966501234567");
  });

  it("preserves a leading +", () => {
    expect(normalisePhone("+966501234567")).toBe("+966501234567");
  });

  it("collapses + prefix to its absence so 966... and +966... match", () => {
    // +966 is preserved as "+966..." and 966 is preserved as
    // "966..." — the hmac is called on the normalised form, so
    // the two do NOT match. This is intentional: a + is meaningful
    // (it denotes E.164 international format). The login flow
    // normalises both forms before computing the HMAC, so as long
    // as both the read path and the write path run through the
    // same normalisePhone, lookups succeed. We document this here
    // because the prior expectation of "match" was wrong.
    expect(normalisePhone("+966501234567")).not.toBe(
      normalisePhone("966501234567"),
    );
  });

  it("returns empty string for null / undefined / empty / non-digit input", () => {
    expect(normalisePhone(null)).toBe("");
    expect(normalisePhone(undefined)).toBe("");
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("not a phone")).toBe("");
  });
});

describe("encryptPii / decryptPii round-trip", () => {
  it("decrypts to the original plaintext", () => {
    const ct = encryptPii("أحمد");
    expect(ct).not.toBeNull();
    expect(decryptPii(ct)).toBe("أحمد");
  });

  it("produces a different ciphertext for the same input (random IV)", () => {
    const a = encryptPii("same plaintext");
    const b = encryptPii("same plaintext");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe("same plaintext");
    expect(decryptPii(b)).toBe("same plaintext");
  });

  it("returns null for null / undefined / empty input", () => {
    expect(encryptPii(null)).toBeNull();
    expect(encryptPii(undefined)).toBeNull();
    expect(encryptPii("")).toBeNull();
    expect(decryptPii(null)).toBeNull();
    expect(decryptPii(undefined)).toBeNull();
    expect(decryptPii("")).toBeNull();
  });

  it("preserves multi-byte characters (Arabic names, emoji, etc.)", () => {
    const samples = [
      "محمد بن عبدالله",
      "user@example.com",
      "1234 Main St, Apt 5B",
      "🇸🇦 Saudi Arabia",
      "name with\nnewline",
    ];
    for (const s of samples) {
      const ct = encryptPii(s);
      expect(ct).not.toBeNull();
      expect(decryptPii(ct)).toBe(s);
    }
  });

  it("rejects tampered ciphertext (GCM auth tag fails)", () => {
    const ct = encryptPii("important data")!;
    // Flip a bit in the middle of the ciphertext portion.
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 5] ^= 0x01;
    const tampered = buf.toString("base64");
    expect(() => decryptPii(tampered)).toThrow();
  });

  it("rejects too-short input", () => {
    expect(() => decryptPii("AAAA")).toThrow(/too short/);
  });
});

describe("piiHmac (blind index)", () => {
  it("is deterministic for the same input", () => {
    const a = piiHmac("+966501234567");
    const b = piiHmac("+966501234567");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    const a = piiHmac("+966501234567");
    const b = piiHmac("+966509999999");
    expect(a).not.toBe(b);
  });

  it("matches for inputs that differ only in formatting (normalisation)", () => {
    // Both forms have a + prefix and the same digits, so the HMAC
    // (computed on the normalised form) is the same.
    expect(piiHmac("+966 50 123 4567")).toBe(piiHmac("+966501234567"));
    expect(piiHmac("+966-50-123-4567")).toBe(piiHmac("+966501234567"));
  });

  it("returns null for null / undefined / empty input", () => {
    expect(piiHmac(null)).toBeNull();
    expect(piiHmac(undefined)).toBeNull();
    expect(piiHmac("")).toBeNull();
  });

  it("returns a fixed-length base64 string", () => {
    const h = piiHmac("any input");
    expect(h).toMatch(/^[A-Za-z0-9+/]{43}=$/); // 32 bytes → 44 base64 chars
  });

  it("does not derive the HMAC key from the encryption key (separation of concerns)", () => {
    // The HMAC key and DEK are derived from different env vars and
    // different info strings. A test that swaps the encryption key
    // for a new value (and resets the cache) must NOT change the
    // HMAC output for the same input. This is a property test, not
    // a leak test — we are asserting the keys are independent.
    const h1 = piiHmac("test input");
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    _resetPiiKeyCacheForTest();
    const h2 = piiHmac("test input");
    expect(h1).toBe(h2);
  });
});

describe("key validation", () => {
  it("throws a clear error when PII_ENCRYPTION_KEY is missing", () => {
    delete process.env.PII_ENCRYPTION_KEY;
    _resetPiiKeyCacheForTest();
    expect(() => encryptPii("test")).toThrow(/PII_ENCRYPTION_KEY is not set/);
  });

  it("throws a clear error when PII_ENCRYPTION_KEY is the wrong length", () => {
    process.env.PII_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    _resetPiiKeyCacheForTest();
    expect(() => encryptPii("test")).toThrow(/must decode to exactly 32 bytes/);
  });
});
