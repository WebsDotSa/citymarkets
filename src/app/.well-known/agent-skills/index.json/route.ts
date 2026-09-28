// Agent Skills Discovery Index
// https://github.com/cloudflare/agent-skills-discovery-rfc

import { NextResponse } from "next/server";
import { createHash } from "crypto";

export const dynamic = "force-static";
export const revalidate = 86400;

// Helper to generate SHA256 digest
function generateDigest(input: string): string {
  return "sha256:" + createHash("sha256").update(input).digest("hex");
}

// Agent Skills Discovery Index
const skillsIndex = {
  // Schema version
  $schema: "https://agentskills.io/schemas/v0.2.0",

  // Index metadata
  index: {
    name: "city-markets-skills",
    version: "1.0.0",
    updated: new Date().toISOString(),
    description: {
      en: "City Markets API skills for shopping and delivery management",
      ar: "مهارات واجهة برمجة تطبيقات أسواق سيتي للتسوق وإدارة التوصيل",
    },
  },

  // Skills array
  skills: [
    // Product Catalog Skills
    {
      name: "search-products",
      type: "function",
      description: {
        en: "Search for products by name, category, vendor, or price range",
        ar: "البحث عن المنتجات بالاسم أو الفئة أو المورد أو نطاق السعر",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/search-products.json",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          category: { type: "string" },
          vendor: { type: "string" },
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
          limit: { type: "number", default: 20 },
        },
      },
      digest: generateDigest("search-products-v1"),
    },
    {
      name: "get-product-details",
      type: "function",
      description: {
        en: "Get detailed information about a specific product",
        ar: "الحصول على معلومات تفصيلية عن منتج معين",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/get-product-details.json",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID" },
        },
        required: ["productId"],
      },
      digest: generateDigest("get-product-details-v1"),
    },
    {
      name: "browse-categories",
      type: "function",
      description: {
        en: "List all product categories with subcategories",
        ar: "قائمة بجميع فئات المنتجات مع الفئات الفرعية",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/browse-categories.json",
      inputSchema: {
        type: "object",
        properties: {
          parentCategory: { type: "string" },
        },
      },
      digest: generateDigest("browse-categories-v1"),
    },
    // Shopping Cart Skills
    {
      name: "view-cart",
      type: "function",
      description: {
        en: "View the current shopping cart contents and total",
        ar: "عرض محتويات سلة التسوق الحالية والإجمالي",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/view-cart.json",
      inputSchema: {
        type: "object",
        properties: {},
      },
      digest: generateDigest("view-cart-v1"),
    },
    {
      name: "add-to-cart",
      type: "function",
      description: {
        en: "Add a product to the shopping cart",
        ar: "إضافة منتج إلى سلة التسوق",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/add-to-cart.json",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "string" },
          quantity: { type: "number", default: 1 },
          vendorSlug: { type: "string" },
        },
        required: ["productId"],
      },
      digest: generateDigest("add-to-cart-v1"),
    },
    {
      name: "update-cart-item",
      type: "function",
      description: {
        en: "Update quantity or remove items from cart",
        ar: "تحديث الكمية أو إزالة العناصر من السلة",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/update-cart-item.json",
      inputSchema: {
        type: "object",
        properties: {
          cartItemId: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["cartItemId"],
      },
      digest: generateDigest("update-cart-item-v1"),
    },
    // Order Management Skills
    {
      name: "create-order",
      type: "function",
      description: {
        en: "Create a new order from the current cart",
        ar: "إنشاء طلب جديد من السلة الحالية",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/create-order.json",
      inputSchema: {
        type: "object",
        properties: {
          deliveryAddress: { type: "string" },
          deliveryNotes: { type: "string" },
          paymentMethod: { type: "string", enum: ["moyasar", "cod"] },
        },
        required: ["deliveryAddress"],
      },
      digest: generateDigest("create-order-v1"),
    },
    {
      name: "track-order",
      type: "function",
      description: {
        en: "Track the status and delivery progress of an order",
        ar: "تتبع حالة الطلب وتقدم التوصيل",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/track-order.json",
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string" },
        },
        required: ["orderId"],
      },
      digest: generateDigest("track-order-v1"),
    },
    {
      name: "list-orders",
      type: "function",
      description: {
        en: "List all orders for the authenticated user",
        ar: "قائمة بجميع طلبات المستخدم المصادق عليه",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/list-orders.json",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          limit: { type: "number", default: 20 },
          offset: { type: "number", default: 0 },
        },
      },
      digest: generateDigest("list-orders-v1"),
    },
    // Vendor Skills
    {
      name: "list-vendors",
      type: "function",
      description: {
        en: "List all available vendors/stores",
        ar: "قائمة بجميع الموردين/المتاجر المتاحة",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/list-vendors.json",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          active: { type: "boolean", default: true },
        },
      },
      digest: generateDigest("list-vendors-v1"),
    },
    {
      name: "get-vendor-products",
      type: "function",
      description: {
        en: "Get products from a specific vendor",
        ar: "الحصول على منتجات من مورد معين",
      },
      url: "https://citymarkets.sa/.well-known/agent-skills/get-vendor-products.json",
      inputSchema: {
        type: "object",
        properties: {
          vendorSlug: { type: "string" },
          category: { type: "string" },
          limit: { type: "number", default: 50 },
        },
        required: ["vendorSlug"],
      },
      digest: generateDigest("get-vendor-products-v1"),
    },
  ],
};

export async function GET() {
  return NextResponse.json(skillsIndex, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"',
        '<https://citymarkets.sa/openapi.json>; rel="service-desc"',
      ].join(", "),
    },
  });
}
