import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import type { StoredChatMessage } from "@/lib/ai-chat-storage";
import type {
  ChatInputMode,
  ChatProductResult,
} from "@/lib/ai-chat-client-types";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

const CONTEXT_TYPE = "shopping_chat";
const MAX_MESSAGES = 80;
const MAX_MATCHED_PRODUCTS = 12;

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMatchedProducts(raw: unknown): ChatProductResult[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const products: ChatProductResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const product = item as Record<string, unknown>;
    const productId = optionalText(product.productId);
    const name = optionalText(product.name);
    const query = optionalText(product.query);
    const displayPrice = Number(product.displayPrice);
    const rawQuantity = Number(product.quantity);
    if (
      !productId ||
      !name ||
      !query ||
      !Number.isFinite(displayPrice) ||
      displayPrice < 0 ||
      !Number.isFinite(rawQuantity)
    ) {
      continue;
    }

    const originalPrice = Number(product.originalPrice);
    products.push({
      productId,
      vendorId: optionalText(product.vendorId),
      name,
      imageUrl: optionalText(product.imageUrl),
      unit: optionalText(product.unit),
      displayPrice,
      originalPrice:
        Number.isFinite(originalPrice) && originalPrice > displayPrice
          ? originalPrice
          : null,
      vendorName: optionalText(product.vendorName),
      quantity: Math.max(1, Math.min(99, Math.trunc(rawQuantity))),
      query,
      addedToCart: product.addedToCart === true,
    });

    if (products.length === MAX_MATCHED_PRODUCTS) break;
  }

  return products.length > 0 ? products : undefined;
}

function normalizeInputMode(value: unknown): ChatInputMode | undefined {
  return value === "text" || value === "voice" ? value : undefined;
}

function normalizeMessages(raw: unknown): StoredChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
    const id = typeof m.id === "string" ? m.id : "";
    const content = typeof m.content === "string" ? m.content : "";
    if (!role || !id || !content) continue;
    out.push({
      id,
      role,
      content,
      timestamp:
        typeof m.timestamp === "string"
          ? m.timestamp
          : new Date().toISOString(),
      inputMode: normalizeInputMode(m.inputMode),
      matchedProducts: normalizeMatchedProducts(m.matchedProducts),
      addedToCart: Array.isArray(m.addedToCart)
        ? m.addedToCart.map(String)
        : undefined,
      mealSuggestions: Array.isArray(m.mealSuggestions)
        ? (m.mealSuggestions as StoredChatMessage["mealSuggestions"])
        : undefined,
      unmatched: Array.isArray(m.unmatched)
        ? m.unmatched.map(String)
        : undefined,
    });
  }
  return out.slice(-MAX_MESSAGES);
}

/** آخر محادثة محفوظة للعميل المسجّل */
export async function GET(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ success: true, messages: [] });
  }

  try {
    const result = await pool.query(
      `SELECT id, messages, created_at
       FROM ai_sessions
       WHERE user_id = $1 AND context_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, CONTEXT_TYPE]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: true, messages: [] });
    }

    const row = result.rows[0] as {
      id: string;
      messages: unknown;
      created_at: string;
    };

    return NextResponse.json({
      success: true,
      sessionId: row.id,
      updatedAt: row.created_at,
      messages: normalizeMessages(row.messages),
    });
  } catch (e) {
    logError("ai-chat history GET:", e);
    return NextResponse.json(
      { success: false, error: "تعذّر تحميل المحادثة" },
      { status: 500 }
    );
  }
}

/** حفظ أو تحديث محادثة العميل */
export async function PUT(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "يلزم تسجيل الدخول لحفظ المحادثة على الحساب" },
      { status: 401 }
    );
  }

  let body: { messages?: unknown; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "طلب غير صالح" },
      { status: 400 }
    );
  }

  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) {
    return NextResponse.json({ success: true, messages: [] });
  }

  try {
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";

    if (sessionId) {
      const updated = await pool.query(
        `UPDATE ai_sessions
         SET messages = $1::jsonb
         WHERE id = $2 AND user_id = $3 AND context_type = $4
         RETURNING id, created_at`,
        [JSON.stringify(messages), sessionId, userId, CONTEXT_TYPE]
      );
      if (updated.rows.length > 0) {
        return NextResponse.json({
          success: true,
          sessionId: updated.rows[0].id,
          updatedAt: updated.rows[0].created_at,
          messages,
        });
      }
    }

    const inserted = await pool.query(
      `INSERT INTO ai_sessions (user_id, messages, context_type)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id, created_at`,
      [userId, JSON.stringify(messages), CONTEXT_TYPE]
    );

    return NextResponse.json({
      success: true,
      sessionId: inserted.rows[0].id,
      updatedAt: inserted.rows[0].created_at,
      messages,
    });
  } catch (e) {
    logError("ai-chat history PUT:", e);
    return NextResponse.json(
      { success: false, error: "تعذّر حفظ المحادثة" },
      { status: 500 }
    );
  }
}

/** مسح المحادثة المحفوظة (إنشاء جلسة جديدة لاحقاً) */
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ success: true });
  }

  try {
    await pool.query(
      `DELETE FROM ai_sessions WHERE user_id = $1 AND context_type = $2`,
      [userId, CONTEXT_TYPE]
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    logError("ai-chat history DELETE:", e);
    return NextResponse.json(
      { success: false, error: "تعذّر مسح المحادثة" },
      { status: 500 }
    );
  }
}
