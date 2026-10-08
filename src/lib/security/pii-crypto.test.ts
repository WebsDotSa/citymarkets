/**
 * Tests for src/lib/security/pii-crypto.ts
 *
 * P0-3 (security Phase 3, 2026-10-03): application-level PII
 * encryption. P0-PII-KMS (security Phase 5, 2026-10-03): envelope
 * encryption with wrapped DEK. These tests exercise both algorithms
 * and the blind index. The full DB migration is a separate concern.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes, createCipheriv, hkdfSync } from "node:crypto";
import {
  encryptPii,
  decryptPii,
  piiHmac,
  piiHmacLegacy,
  normalisePhone,
  _resetPiiKeyCacheForTest,
  aesKeyWrap,
  aesKeyUnwrap,
} from "@/lib/security/pii-crypto";

// Wrap a DEK with a KEK using AES-256-KW. Mirrors what
// scripts/generate-pii-dek.ts does, inlined here so the test does
// not need to spawn a subprocess.
function wrapDekB64(dek: Buffer, kek: Buffer): string {
  return aesKeyWrap(kek, dek).toString("base64");
}
function unwrapDek(wrappedB64: string, kek: Buffer): Buffer {
  return aesKeyUnwrap(kek, Buffer.from(wrappedB64, "base64"));
}

let KEK: Buffer;
let DEK: Buffer;
const LEGACY_ENCRYPTION_KEY_B64 = randomBytes(32).toString("base64");
const LEGACY_HMAC_KEY_B64 = randomBytes(32).toString("base64");

function installKeys(): void {
  process.env.PII_MASTER_KEY = KEK.toString("base64");
  process.env.PII_DATA_KEY = wrapDekB64(DEK, KEK);
  process.env.PII_ENCRYPTION_KEY = LEGACY_ENCRYPTION_KEY_B64;
  process.env.PII_HMAC_KEY = LEGACY_HMAC_KEY_B64;
  _resetPiiKeyCacheForTest();
}

beforeAll(() => {
  KEK = randomBytes(32);
  DEK = randomBytes(32);
  installKeys();
});

beforeEach(() => {
  installKeys();
});

// Real phone numbers used as the "old placeholder" `****` was just a
// redaction display artifact in the LLM-readable source view.
const PHONE_A = "+966501234567";
const PHONE_B = "+966501234999";

describe("normalisePhone", () => {
  it("strips spaces, dashes, and parentheses", () => {
    expect(normalisePhone("+966 50 123 4567")).toBe("+966501234567");
    expect(normalisePhone("966-50-123-4567")).toBe("966501234567");
    expect(normalisePhone("(966) 501 234 567")).toBe("966501234567");
  });

  it("preserves a leading +", () => {
    expect(normalisePhone(PHONE_A)).toBe(PHONE_A);
  });

  it("returns empty string for null / undefined / empty / non-digit input", () => {
    expect(normalisePhone(null)).toBe("");
    expect(normalisePhone(undefined)).toBe("");
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("not a phone")).toBe("");
  });
});

describe("encryptPii / decryptPii round-trip (envelope format)", () => {
  it("decrypts to the original plaintext", () => {
    const ct = encryptPii("\u0623\u062D\u0645\u062F");
    expect(ct).not.toBeNull();
    expect(decryptPii(ct)).toBe("\u0623\u062D\u0645\u062F");
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
      "\u0645\u062D\u0645\u062F \u0628\u0646 \u0639\u0628\u062F\u0627\u0644\u0644\u0647",
      "user@example.com",
      "1234 Main St, Apt 5B",
      "\uD83C\uDDF8\uD83C\uDDFA Saudi Arabia",
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
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 5] ^= 0x01;
    const tampered = buf.toString("base64");
    expect(() => decryptPii(tampered)).toThrow();
  });

  it("rejects too-short input", () => {
    expect(() => decryptPii("AAAA")).toThrow(/too short/);
  });

  it("emits the envelope format (0x01 prefix + version byte + iv)", () => {
    const ct = encryptPii("payload")!;
    const buf = Buffer.from(ct, "base64");
    expect(buf[0]).toBe(0x01);
    expect(buf[1]).toBe(0x01);
    expect(buf.length).toBeGreaterThan(2 + 12 + 16);
  });
});

describe("envelope DEK wrap/unwrap round-trip", () => {
  it("the wrapped DEK in env round-trips to the same DEK bytes", () => {
    const wrapped = process.env.PII_DATA_KEY!;
    const recovered = unwrapDek(wrapped, KEK);
    expect(recovered.equals(DEK)).toBe(true);
  });

  it("a wrapped DEK built with the wrong KEK fails to unwrap", () => {
    const otherKek = randomBytes(32);
    const bad = wrapDekB64(DEK, otherKek);
    expect(() => unwrapDek(bad, KEK)).toThrow();
  });

  it("a tampered wrapped DEK fails to unwrap", () => {
    const wrapped = process.env.PII_DATA_KEY!;
    const buf = Buffer.from(wrapped, "base64");
    buf[0] ^= 0x01;
    expect(() => unwrapDek(buf.toString("base64"), KEK)).toThrow();
  });
});

describe("backward compatibility with legacy P0-3 ciphertext", () => {
  function legacyEncrypt(plaintext: string): string {
    const master = Buffer.from(process.env.PII_ENCRYPTION_KEY!, "base64");
    const derived = hkdfSync(
      "sha256",
      master,
      Buffer.alloc(0),
      Buffer.from("citymarkets-pii-dek-v1"),
      32,
    );
    const dek = Buffer.from(derived);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString("base64");
  }

  it("decrypts a legacy-format row using the legacy KEK", () => {
    const ct = legacyEncrypt("legacy user");
    expect(decryptPii(ct)).toBe("legacy user");
  });

  it("returns different plaintext when given legacy ciphertext", () => {
    const a = legacyEncrypt("alpha");
    const b = legacyEncrypt("beta");
    expect(decryptPii(a)).toBe("alpha");
    expect(decryptPii(b)).toBe("beta");
  });

  it("rejects a legacy-format row when PII_ENCRYPTION_KEY is missing", () => {
    const ct = legacyEncrypt("legacy user");
    delete process.env.PII_ENCRYPTION_KEY;
    _resetPiiKeyCacheForTest();
    expect(() => decryptPii(ct)).toThrow(/PII_ENCRYPTION_KEY is not set/);
    process.env.PII_ENCRYPTION_KEY = LEGACY_ENCRYPTION_KEY_B64;
    _resetPiiKeyCacheForTest();
  });
});

describe("piiHmac (blind index)", () => {
  it("is deterministic for the same input", () => {
    expect(piiHmac(PHONE_A)).toBe(piiHmac(PHONE_A));
  });

  it("differs for different inputs", () => {
    expect(piiHmac(PHONE_A)).not.toBe(piiHmac(PHONE_B));
  });

  it("matches for inputs that differ only in formatting (normalisation)", () => {
    expect(piiHmac("+966 50 123 4567")).toBe(piiHmac(PHONE_A));
    expect(piiHmac("+966-50-123-4567")).toBe(piiHmac(PHONE_A));
  });

  it("returns null for null / undefined / empty input", () => {
    expect(piiHmac(null)).toBeNull();
    expect(piiHmac(undefined)).toBeNull();
    expect(piiHmac("")).toBeNull();
  });

  it("returns a fixed-length base64 string", () => {
    const h = piiHmac("any input");
    expect(h).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("does not derive the HMAC key from PII_ENCRYPTION_KEY (separation)", () => {
    const h1 = piiHmac("test input");
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    _resetPiiKeyCacheForTest();
    const h2 = piiHmac("test input");
    expect(h1).toBe(h2);
  });

  it("piiHmacLegacy produces an HMAC distinct from piiHmac", () => {
    const hActive = piiHmac(PHONE_A);
    const hLegacy = piiHmacLegacy(PHONE_A);
    expect(hActive).not.toBeNull();
    expect(hLegacy).not.toBeNull();
    expect(hActive).not.toBe(hLegacy);
  });

  it("piiHmacLegacy returns null when PII_HMAC_KEY is unset", () => {
    delete process.env.PII_HMAC_KEY;
    _resetPiiKeyCacheForTest();
    expect(piiHmacLegacy("anything")).toBeNull();
    process.env.PII_HMAC_KEY = LEGACY_HMAC_KEY_B64;
    _resetPiiKeyCacheForTest();
  });
});

describe("key validation", () => {
  it("throws a clear error when PII_MASTER_KEY is missing", () => {
    delete process.env.PII_MASTER_KEY;
    _resetPiiKeyCacheForTest();
    expect(() => encryptPii("test")).toThrow(/PII_MASTER_KEY is not set/);
  });

  it("throws a clear error when PII_MASTER_KEY is the wrong length", () => {
    process.env.PII_MASTER_KEY = randomBytes(16).toString("base64");
    _resetPiiKeyCacheForTest();
    expect(() => encryptPii("test")).toThrow(/must decode to exactly 32 bytes/);
  });

  it("throws a clear error when PII_DATA_KEY is missing", () => {
    delete process.env.PII_DATA_KEY;
    _resetPiiKeyCacheForTest();
    expect(() => encryptPii("test")).toThrow(/PII_DATA_KEY is not set/);
  });
});
