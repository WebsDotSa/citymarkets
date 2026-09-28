// OpenAPI 3.1 Specification with MPP x-payment-info Extensions
// https://mpp.dev
// https://datatracker.ietf.org/doc/draft-payment-discovery-00.txt

// ──────────────────────────────────────────────────────────────────────
// MAINTENANCE GAP (2026-09-23)
// ──────────────────────────────────────────────────────────────────────
// This spec is HAND-MAINTAINED and currently documents ~12 of the
// project's 144+ route handlers. It exists primarily for AI-agent
// discovery (`llms.txt` + markdown-for-agents mirror) and SEO crawlers,
// NOT as a contract test surface. Three caveats:
//
//   1. The /api/v1 tree has 110+ handlers; only the public-discovery
//      subset is documented here. Internal endpoints (cart, orders,
//      checkout, payments) are wired via the agent-friendly
//      `llms.txt` and the markdown-for-agents mirror under `/md`.
//
//   2. When you ADD a route that should be agent-discoverable, append
//      a `paths` entry below with a `summary` + `x-payment-info`
//      block. Don't bother for purely-internal endpoints — the
//      customer-facing surface is what agents need.
//
//   3. A full regeneration from JSDoc + Zod schemas is feasible but
//      out of scope today. If/when we generate it, the canonical
//      source of truth for each route's contract is its own
//      `route.ts` + the matching schema in `@/lib/validation`.
//      Reference: src/lib/validation.ts (Zod) + `req.headers`
//      reads in each handler for auth/CSRF/rate-limit.
//
// The `x-payment-info` MPP extension stays here because the public
// discovery spec is the right place for it — agents check payment
// intent before invoking an endpoint.

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "City Markets API",
    description: "Saudi Arabian multi-vendor supermarket delivery platform API with AI agent support",
    version: "1.0.0",
    contact: {
      name: "City Markets Support",
      email: "support@citymarkets.sa",
      url: "https://citymarkets.sa/contact",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "https://citymarkets.sa/api/v1",
      description: "Production API",
    },
  ],
  
  // Paths with MPP payment extensions
  paths: {
    "/products": {
      get: {
        operationId: "listProducts",
        summary: "List products",
        description: "Get a paginated list of products with optional filtering",
        tags: ["Products"],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "featured", in: "query", schema: { type: "boolean" } },
          { name: "deals", in: "query", schema: { type: "boolean" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["price-asc", "price-desc", "newest"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProductsResponse" },
              },
              "text/markdown": {
                schema: { type: "string" },
                description: "Markdown formatted response for AI agents",
              },
            },
          },
        },
        // MPP Payment Info Extension
        "x-payment-info": {
          intent: "free",
          description: "Product browsing is free",
        },
      },
    },
    "/products/{id}": {
      get: {
        operationId: "getProduct",
        summary: "Get product details",
        tags: ["Products"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Product details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Product" },
              },
            },
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Product details viewing is free",
        },
      },
    },
    "/categories": {
      get: {
        operationId: "listCategories",
        summary: "List categories",
        tags: ["Categories"],
        responses: {
          "200": {
            description: "Categories list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CategoriesResponse" },
              },
            },
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Category browsing is free",
        },
      },
    },
    "/vendors": {
      get: {
        operationId: "listVendors",
        summary: "List vendors/stores",
        tags: ["Vendors"],
        responses: {
          "200": {
            description: "Vendors list",
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Vendor browsing is free",
        },
      },
    },
    "/cart": {
      get: {
        operationId: "getCart",
        summary: "Get cart contents",
        tags: ["Cart"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Cart contents",
          },
        },
      },
      post: {
        operationId: "addToCart",
        summary: "Add item to cart",
        tags: ["Cart"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  productId: { type: "string" },
                  quantity: { type: "integer", default: 1 },
                },
                required: ["productId"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Item added to cart",
          },
        },
      },
    },
    "/orders": {
      get: {
        operationId: "listOrders",
        summary: "List user orders",
        tags: ["Orders"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Orders list",
          },
        },
      },
      post: {
        operationId: "createOrder",
        summary: "Create new order",
        tags: ["Orders"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  deliveryAddress: { type: "string" },
                  deliveryNotes: { type: "string" },
                  paymentMethod: { type: "string", enum: ["moyasar", "cod"] },
                },
                required: ["deliveryAddress"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Order created",
          },
        },
        // MPP Payment Extension for paid orders
        "x-payment-info": {
          intent: "charge",
          method: "moyasar",
          // Tamara (BNPL) is also supported; checkout selects provider
          // based on cart total + `paymentMethod` field.
          alternatives: ["tamara"],
          amount: "variable",
          currency: "SAR",
          description: "Order total based on cart contents",
        },
      },
    },
    "/orders/{id}": {
      get: {
        operationId: "getOrder",
        summary: "Get order details",
        tags: ["Orders"],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Order details",
          },
        },
      },
    },
    "/payments/initiate": {
      post: {
        operationId: "initiatePayment",
        summary: "Initiate payment for order",
        tags: ["Payments"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  orderId: { type: "string" },
                  amount: { type: "number" },
                  currency: { type: "string", default: "SAR" },
                  paymentMethod: { type: "string" },
                },
                required: ["orderId", "amount"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Payment initiated",
          },
        },
        // MPP Payment - this is a paid endpoint
        "x-payment-info": {
          intent: "charge",
          method: "stripe",
          amount: "variable",
          currency: "SAR",
          description: "Payment processing fee may apply",
        },
      },
    },
    "/delivery": {
      post: {
        operationId: "calculateDelivery",
        summary: "Calculate delivery cost",
        tags: ["Delivery"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  address: { type: "string" },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Delivery calculation",
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Delivery calculation is free",
        },
      },
    },
    // Auth endpoints
    "/auth/login": {
      post: {
        operationId: "login",
        summary: "User login",
        tags: ["Authentication"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  phone: { type: "string" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Authentication is free",
        },
      },
    },
    "/auth/register": {
      post: {
        operationId: "register",
        summary: "Register new user",
        tags: ["Authentication"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  phone: { type: "string" },
                  name: { type: "string" },
                  email: { type: "string" },
                  password: { type: "string" },
                },
                required: ["phone", "password"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Registration successful",
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Registration is free",
        },
      },
    },
    // AI Chat endpoint
    "/ai-chat": {
      post: {
        operationId: "aiChat",
        summary: "AI Shopping Assistant",
        description: "Chat with AI assistant for shopping help",
        tags: ["AI"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  context: { type: "object" },
                },
                required: ["message"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "AI response",
          },
        },
        "x-payment-info": {
          intent: "free",
          description: "Basic AI chat is free",
        },
      },
    },
  },
  
  components: {
    schemas: {
      Product: {
        type: "object",
        properties: {
          id: { type: "string" },
          name_ar: { type: "string" },
          name_en: { type: "string" },
          description: { type: "string" },
          price: { type: "number" },
          discount_price: { type: "number" },
          stock_qty: { type: "integer" },
          unit: { type: "string" },
          image_url: { type: "string" },
          category_name: { type: "string" },
        },
      },
      ProductsResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Product" } },
          pagination: {
            type: "object",
            properties: {
              page: { type: "integer" },
              limit: { type: "integer" },
              total: { type: "integer" },
              totalPages: { type: "integer" },
            },
          },
        },
      },
      Category: {
        type: "object",
        properties: {
          id: { type: "string" },
          name_ar: { type: "string" },
          name_en: { type: "string" },
          slug: { type: "string" },
          icon_url: { type: "string" },
        },
      },
      CategoriesResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Category" } },
        },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          total: { type: "number" },
          items: { type: "array" },
          delivery_address: { type: "string" },
          created_at: { type: "string" },
        },
      },
    },
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from /auth/login",
      },
    },
  },
  
  // Tags for grouping
  tags: [
    { name: "Products", description: "Product catalog operations" },
    { name: "Categories", description: "Category management" },
    { name: "Vendors", description: "Vendor/store management" },
    { name: "Cart", description: "Shopping cart operations" },
    { name: "Orders", description: "Order management" },
    { name: "Payments", description: "Payment processing" },
    { name: "Delivery", description: "Delivery services" },
    { name: "Authentication", description: "User authentication" },
    { name: "AI", description: "AI-powered features" },
  ],
  
  // MPP Extensions
  "x-mpp": {
    version: "1.0.0",
    enabled: true,
    facilitator_url: "https://mpp.citymarkets.sa",
    wallet_address: "0x...", // To be configured
    supported_methods: ["stripe", "card", "cod"],
    default_currency: "SAR",
  },
  
  // WebMCP support
  "x-webmcp": {
    enabled: true,
    endpoint: "https://citymarkets.sa/api/v1/mcp",
  },
  
  // External documentation
  externalDocs: {
    url: "https://citymarkets.sa/docs/api",
    description: "Full API documentation",
  },
};

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/vnd.oai.openapi+json;version=3.1; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      // Link headers for discovery
      Link: [
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"',
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"',
        '<https://citymarkets.sa/auth.md>; rel="service-doc"; type="text/markdown"',
        '<https://citymarkets.sa/docs/api>; rel="service-doc"',
      ].join(", "),
    },
  });
}
