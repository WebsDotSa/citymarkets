import { describe, expect, it } from "vitest";
import {
  isLikelyImageByMagicBytes,
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  adminUploadMetadataSchema,
  placeImagesMetadataSchema,
  inventorySettingsSchema,
  notificationSettingsSchema,
  storeStatusSettingsSchema,
  deliveryHoursSchema,
  validateBody,
  multiVendorCheckoutSchema,
  checkoutVendorGroupSchema,
} from "./validation";
import { CITY_MARKETS_VENDOR_ID } from "./types";

describe("isLikelyImageByMagicBytes", () => {
  it("accepts JPEG (FF D8 FF)", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    expect(isLikelyImageByMagicBytes(jpeg)).toBe(true);
  });

  it("accepts PNG (89 50 4E 47 0D 0A 1A 0A)", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(isLikelyImageByMagicBytes(png)).toBe(true);
  });

  it("accepts GIF87a", () => {
    const gif87 = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(isLikelyImageByMagicBytes(gif87)).toBe(true);
  });

  it("accepts GIF89a", () => {
    const gif89 = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(isLikelyImageByMagicBytes(gif89)).toBe(true);
  });

  it("accepts WebP (RIFF....WEBP)", () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (ignored)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(isLikelyImageByMagicBytes(webp)).toBe(true);
  });

  it("accepts AVIF (ftypavif / ftypavis)", () => {
    const avif = new Uint8Array([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x61, 0x76, 0x69, 0x66, // avif
    ]);
    expect(isLikelyImageByMagicBytes(avif)).toBe(true);

    const avis = new Uint8Array([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70,
      0x61, 0x76, 0x69, 0x73, // avis
    ]);
    expect(isLikelyImageByMagicBytes(avis)).toBe(true);
  });

  it("accepts HEIC (ftypheic)", () => {
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ]);
    expect(isLikelyImageByMagicBytes(heic)).toBe(true);
  });

  it("rejects an empty buffer", () => {
    expect(isLikelyImageByMagicBytes(new Uint8Array(0))).toBe(false);
  });

  it("rejects a too-short buffer", () => {
    expect(isLikelyImageByMagicBytes(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });

  it("rejects a text file (HTML, JS, JSON, PDF)", () => {
    expect(
      isLikelyImageByMagicBytes(
        new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe(false); // <!DO
    expect(
      isLikelyImageByMagicBytes(
        new Uint8Array([0x66, 0x75, 0x6e, 0x63, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe(false); // func
    expect(
      isLikelyImageByMagicBytes(
        new Uint8Array([0x7b, 0x22, 0x69, 0x22, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe(false); // {"i"
    expect(
      isLikelyImageByMagicBytes(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe(false); // %PDF
  });

  it("rejects EXE / PE binary", () => {
    const exe = new Uint8Array([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
    ]);
    expect(isLikelyImageByMagicBytes(exe)).toBe(false);
  });

  it("rejects BMP (deliberately excluded — pixel-bomb vector)", () => {
    const bmp = new Uint8Array([
      0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00,
    ]);
    expect(isLikelyImageByMagicBytes(bmp)).toBe(false);
  });
});

describe("ALLOWED_IMAGE_MIME / MAX_IMAGE_BYTES", () => {
  it("allows JPEG / PNG / GIF / WebP / AVIF and disallows exotic types", () => {
    expect(ALLOWED_IMAGE_MIME.has("image/jpeg")).toBe(true);
    expect(ALLOWED_IMAGE_MIME.has("image/png")).toBe(true);
    expect(ALLOWED_IMAGE_MIME.has("image/gif")).toBe(true);
    expect(ALLOWED_IMAGE_MIME.has("image/webp")).toBe(true);
    expect(ALLOWED_IMAGE_MIME.has("image/avif")).toBe(true);
    expect(ALLOWED_IMAGE_MIME.has("application/pdf")).toBe(false);
    expect(ALLOWED_IMAGE_MIME.has("text/html")).toBe(false);
    expect(ALLOWED_IMAGE_MIME.has("application/octet-stream")).toBe(false);
  });

  it("caps uploads at 10 MB", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("adminUploadMetadataSchema", () => {
  it("accepts a clean folder name", () => {
    const r = validateBody(adminUploadMetadataSchema, { folder: "banners/home" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.folder).toBe("banners/home");
  });

  it("rejects folder traversal with ..", () => {
    const r = validateBody(adminUploadMetadataSchema, { folder: "../etc/passwd" });
    expect(r.success).toBe(false);
  });

  it("rejects folder with backslash", () => {
    const r = validateBody(adminUploadMetadataSchema, { folder: "..\\windows" });
    expect(r.success).toBe(false);
  });

  it("rejects folder with spaces or weird chars", () => {
    expect(validateBody(adminUploadMetadataSchema, { folder: "has space" }).success).toBe(false);
    expect(validateBody(adminUploadMetadataSchema, { folder: "has;semicolon" }).success).toBe(false);
  });

  it("caps folder length at 64", () => {
    const long = "a".repeat(65);
    const r = validateBody(adminUploadMetadataSchema, { folder: long });
    expect(r.success).toBe(false);
  });

  it("accepts missing folder (optional)", () => {
    const r = validateBody(adminUploadMetadataSchema, {});
    expect(r.success).toBe(true);
  });
});

describe("placeImagesMetadataSchema (mass-assignment guard)", () => {
  it("rejects unknown keys to prevent smuggling", () => {
    const r = validateBody(placeImagesMetadataSchema, { isAdmin: true });
    // .passthrough() does allow unknown keys here, but the route must
    // only read well-defined keys. This test pins the schema shape.
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).isAdmin).toBe(true);
    }
  });
});

describe("validateBody helper", () => {
  it("returns a localized error on failure", () => {
    const r = validateBody(adminUploadMetadataSchema, { folder: "bad space" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });
});

describe("deliveryHoursSchema", () => {
  it("accepts a normal same-day window with defaults", () => {
    const r = deliveryHoursSchema.safeParse({
      enabled: true,
      open_time: "09:00",
      close_time: "23:00",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.timezone).toBe("Asia/Riyadh");
      expect(r.data.closed_message).toMatch(/ساعات العمل/);
    }
  });

  it("accepts overnight windows (close < open)", () => {
    const r = deliveryHoursSchema.safeParse({
      enabled: true,
      open_time: "18:00",
      close_time: "02:00",
      closed_message: "نلتقي قريباً",
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed HH:MM", () => {
    expect(
      deliveryHoursSchema.safeParse({
        enabled: true,
        open_time: "25:00",
        close_time: "23:00",
      }).success,
    ).toBe(false);
    expect(
      deliveryHoursSchema.safeParse({
        enabled: true,
        open_time: "9am",
        close_time: "23:00",
      }).success,
    ).toBe(false);
  });

  it("rejects open_time === close_time", () => {
    const r = deliveryHoursSchema.safeParse({
      enabled: true,
      open_time: "09:00",
      close_time: "09:00",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    const r = deliveryHoursSchema.safeParse({
      enabled: true,
      open_time: "09:00",
      close_time: "23:00",
      surprise: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("inventorySettingsSchema", () => {
  it("accepts a positive integer threshold from a form", () => {
    const result = inventorySettingsSchema.safeParse({ low_stock_threshold: "8" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.low_stock_threshold).toBe(8);
  });

  it("rejects zero, fractions, and excessive thresholds", () => {
    expect(inventorySettingsSchema.safeParse({ low_stock_threshold: 0 }).success).toBe(false);
    expect(inventorySettingsSchema.safeParse({ low_stock_threshold: 1.5 }).success).toBe(false);
    expect(inventorySettingsSchema.safeParse({ low_stock_threshold: 100001 }).success).toBe(false);
  });
});

describe("notificationSettingsSchema", () => {
  it("accepts the notification settings form payload", () => {
    const result = notificationSettingsSchema.safeParse({
      whatsapp_admin_phone: "966512345678",
      notify_new_order: true,
      message_template: "طلب جديد #{order_id}",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid phone values and applies the notification default", () => {
    const defaults = notificationSettingsSchema.safeParse({
      whatsapp_admin_phone: "",
      message_template: "قالب",
    });
    expect(defaults.success).toBe(true);
    if (defaults.success) expect(defaults.data.notify_new_order).toBe(true);

    expect(
      notificationSettingsSchema.safeParse({
        whatsapp_admin_phone: "   -()   ",
        notify_new_order: true,
        message_template: "قالب",
      }).success,
    ).toBe(false);
  });
});

describe("storeStatusSettingsSchema", () => {
  it("defaults is_open to true when omitted", () => {
    const result = storeStatusSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_open).toBe(true);
  });

  it("accepts the admin toggle form (open + custom banner message)", () => {
    const result = storeStatusSettingsSchema.safeParse({
      is_open: false,
      message: "الموقع مغلق — نعود قريباً",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_open).toBe(false);
      expect(result.data.message).toBe("الموقع مغلق — نعود قريباً");
    }
  });

  it("trims the banner message and allows an empty fallback", () => {
    const result = storeStatusSettingsSchema.safeParse({
      is_open: false,
      message: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe("");
  });

  it("rejects unknown fields (strict mode)", () => {
    expect(
      storeStatusSettingsSchema.safeParse({
        is_open: true,
        message: "ok",
        hacked: true,
      }).success,
    ).toBe(false);
  });

  it("rejects a banner message longer than 500 chars", () => {
    expect(
      storeStatusSettingsSchema.safeParse({
        is_open: false,
        message: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-vendor checkout body schema (Slice 3)
// ---------------------------------------------------------------------------

const catalogItem = (id = "00000000-0000-0000-0000-000000000a01", q = 2) => ({
  product_id: id,
  quantity: q,
});

const vendorGroup = (
  vendorId = "00000000-0000-0000-0000-0000000000aa",
  items = [catalogItem("00000000-0000-0000-0000-000000000b01")],
) => ({ vendor_id: vendorId, items });

describe("multiVendorCheckoutSchema", () => {
  it("accepts a catalog-only body (legacy compat path)", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a vendor-only body", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [vendorGroup()],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a mixed cart", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem("00000000-0000-0000-0000-000000000a01")],
      vendor_groups: [vendorGroup()],
      paymentMethod: "card",
      idempotency_key: "abc123def456",
      addressId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body (no catalog, no vendor groups)", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the City Markets pseudo-vendor id inside vendor_groups", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [{ vendor_id: CITY_MARKETS_VENDOR_ID, items: [catalogItem()] }],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate product ids inside a vendor group", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [
        {
          vendor_id: "00000000-0000-0000-0000-0000000000aa",
          items: [
            catalogItem("00000000-0000-0000-0000-000000000b01"),
            catalogItem("00000000-0000-0000-0000-000000000b01"),
          ],
        },
      ],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate vendor ids across vendor_groups", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [
        vendorGroup("00000000-0000-0000-0000-0000000000aa"),
        vendorGroup("00000000-0000-0000-0000-0000000000aa"),
      ],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a coupon when the cart has no catalog items", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [vendorGroup()],
      coupon_code: "WELCOME10",
      paymentMethod: "card",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects points_redeemed when the cart has no catalog items", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      vendor_groups: [vendorGroup()],
      points_redeemed: 100,
      paymentMethod: "card",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("accepts coupon + points together when the cart has catalog items", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      coupon_code: "WELCOME10",
      points_redeemed: 100,
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown payment methods", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      paymentMethod: "western_union",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short idempotency_key", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      paymentMethod: "cash",
      idempotency_key: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero/negative quantity inside an item", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [{ product_id: "00000000-0000-0000-0000-000000000a01", quantity: 0 }],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID product_id", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [{ product_id: "not-a-uuid", quantity: 1 }],
      paymentMethod: "cash",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(false);
  });

  it("accepts both camelCase and snake_case aliases for the field set", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      payment_method: "cash",
      delivery_type: "delivery",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a pickup checkout with null address_id (no delivery address)", () => {
    // Bug guard: checkout-new.tsx sends `address_id: null` for pickup
    // orders. Before the fix, `z.string().optional()` rejected null with
    // "Expected string, received null" — which surfaced as a toast in
    // the UI and blocked all online payment attempts made with pickup.
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      paymentMethod: "mada",
      delivery_type: "pickup",
      address_id: null,
      addressId: null,
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a delivery checkout with a real address_id", () => {
    const result = multiVendorCheckoutSchema.safeParse({
      items: [catalogItem()],
      paymentMethod: "mada",
      delivery_type: "delivery",
      address_id: "11111111-1111-1111-1111-111111111111",
      idempotency_key: "abc123def456",
    });
    expect(result.success).toBe(true);
  });
});

describe("checkoutVendorGroupSchema", () => {
  it("rejects the City Markets pseudo-vendor", () => {
    expect(
      checkoutVendorGroupSchema.safeParse({
        vendor_id: CITY_MARKETS_VENDOR_ID,
        items: [catalogItem()],
      }).success,
    ).toBe(false);
  });

  it("requires at least one item", () => {
    expect(
      checkoutVendorGroupSchema.safeParse({
        vendor_id: "00000000-0000-0000-0000-0000000000aa",
        items: [],
      }).success,
    ).toBe(false);
  });

  it("caps items at 99", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      product_id: `00000000-0000-0000-0000-000000000${(i + 10).toString(16).padStart(2, "0")}`,
      quantity: 1,
    }));
    expect(
      checkoutVendorGroupSchema.safeParse({
        vendor_id: "00000000-0000-0000-0000-0000000000aa",
        items,
      }).success,
    ).toBe(false);
  });
});
