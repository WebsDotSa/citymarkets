// WebMCP Provider Component
// https://webmachinelearning.github.io/webmcp/
// https://developer.chrome.com/blog/webmcp-epp
//
// Cloudflare isitagentready.com scanner detects WebMCP via
// `navigator.modelContext.registerTool()` calls. Earlier drafts of the
// spec used `navigator.modelContextProvider.provideContext({tools:[...]})`
// — that was deprecated in Chrome 146. We register each tool individually
// with `registerTool(name, {description, inputSchema, execute})`, which
// is the current surface the scanner validates. (2026-08-17)

'use client';

import { useEffect } from 'react';
import { isProd } from '@/lib/env';
import { info, warn } from "@/lib/logger";

/**
 * Each tool registers via `navigator.modelContext.registerTool(name, def)`
 * where `def` is `{ description, inputSchema, outputSchema?, execute? }`.
 * The scanner reads `navigator.modelContext` from the page and looks for
 * the registered tool names. The `execute` callback is optional — the
 * scanner only requires the tool to be registered and introspectable.
 *
 * We wrap each fetch into a typed `execute` so a real agent running in
 * Chrome can actually CALL the tools (not just discover them).
 */
function makeExecute(path: string, init?: RequestInit) {
  return async (args: any) => {
    try {
      const res = await fetch(path, {
        method: init?.method ?? "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
        body: args !== undefined ? JSON.stringify(args) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return data;
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  };
}

// Tool definitions — kept in the same shape as before so the scanner
// can introspect them, but registered one-by-one via registerTool().
const cityMarketsTools: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execute?: (args: any) => Promise<unknown>;
}> = [
  // Product Search Tool
  {
    name: "search_products",
    description: "Search for products by name, category, or keyword (Saudi supermarket catalog)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        category: { type: "string", description: "Category slug to filter by" },
        featured: { type: "boolean", description: "Only return featured products" },
        deals: { type: "boolean", description: "Only return products on sale" },
        limit: { type: "number", description: "Maximum number of results", default: 20 },
      },
    },
    execute: makeExecute("/api/v1/products"),
  },
  // Get Product Details Tool
  {
    name: "get_product_details",
    description: "Get detailed information about a specific product",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string", description: "The unique product identifier" } },
      required: ["productId"],
    },
    execute: makeExecute("/api/v1/products", { method: "POST" }),
  },
  // Browse Categories Tool
  {
    name: "browse_categories",
    description: "List all product categories and subcategories",
    inputSchema: {
      type: "object",
      properties: { parentCategory: { type: "string", description: "Parent category slug" } },
    },
    execute: makeExecute("/api/v1/categories", { method: "GET" }),
  },
  // View Cart Tool
  {
    name: "view_cart",
    description: "View the current shopping cart contents and total",
    inputSchema: { type: "object", properties: {} },
    execute: makeExecute("/api/v1/cart", { method: "GET" }),
  },
  // Add to Cart Tool
  {
    name: "add_to_cart",
    description: "Add a product to the shopping cart",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product ID to add" },
        quantity: { type: "number", description: "Quantity to add", default: 1 },
      },
      required: ["productId"],
    },
    execute: makeExecute("/api/v1/cart"),
  },
  // Create Order Tool
  {
    name: "create_order",
    description: "Create a new order from the current cart",
    inputSchema: {
      type: "object",
      properties: {
        deliveryAddress: { type: "string", description: "Delivery address" },
        deliveryNotes: { type: "string", description: "Special delivery instructions" },
        paymentMethod: { type: "string", enum: ["moyasar", "cod"], description: "Payment method", default: "moyasar" },
      },
      required: ["deliveryAddress"],
    },
    execute: makeExecute("/api/v1/orders"),
  },
  // Track Order Tool
  {
    name: "track_order",
    description: "Track the status and delivery progress of an order",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", description: "Order ID to track" } },
      required: ["orderId"],
    },
    execute: makeExecute("/api/v1/orders"),
  },
  // List Vendors Tool
  {
    name: "list_vendors",
    description: "List all available vendors/stores on City Markets",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Filter by category" } },
    },
    execute: makeExecute("/api/v1/vendors", { method: "GET" }),
  },
];

interface WebMCPApi {
  registerTool(
    name: string,
    def: {
      description: string;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      execute?: (args: any) => Promise<unknown> | unknown;
    }
  ): void;
}

export function WebMCPProvider() {
  useEffect(() => {
    const nav = (typeof navigator !== "undefined" ? navigator : null) as
      | (Navigator & { modelContext?: WebMCPApi })
      | null;

    if (!nav?.modelContext || typeof nav.modelContext.registerTool !== "function") {
      if (!isProd) {
        // Audit I39: canonical logger; still dev-gated by isProd.
        info(
          "[WebMCP] navigator.modelContext.registerTool not available — skipping tool registration"
        );
      }
      return;
    }

    // Register each tool on the shared modelContext registry. The scanner
    // walks `navigator.modelContext._tools` (or equivalent) to confirm
    // tools are exposed. (2026-08-17 — Chrome 146+ API surface.)
    for (const tool of cityMarketsTools) {
      try {
        nav.modelContext.registerTool(tool.name, {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          execute: tool.execute,
        });
      } catch (e) {
        if (!isProd) {
          // Audit I39: canonical logger; still dev-gated by isProd.
          warn(`[WebMCP] failed to register ${tool.name}`, { reason: (e as Error).message });
        }
      }
    }

    if (!isProd) {
      // Audit I39: canonical logger; still dev-gated by isProd.
      info(
        `[WebMCP] registered ${cityMarketsTools.length} tools: ${cityMarketsTools.map((t) => t.name).join(", ")}`
      );
    }
  }, []);

  return null;
}
