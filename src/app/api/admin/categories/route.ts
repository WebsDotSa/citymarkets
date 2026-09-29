import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { generateSlug } from "@/lib/slug";
import { cache } from "@/lib/cache";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";
import { deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idCheck(url: URL) {
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 }
    );
  }
  return id;
}

async function ensureSlugUnique(
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug;
  let counter = 2;
  while (counter < 200) {
    const r = await query(
      "SELECT id FROM categories WHERE slug = $1 LIMIT 1",
      [candidate]
    );
    if (r.rows.length === 0) return candidate;
    if (excludeId && r.rows[0].id === excludeId) return candidate;
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }
  return `${baseSlug}-${Date.now()}`;
}

class ParentTooDeepError extends Error {
  constructor() {
    super("PARENT_TOO_DEEP");
  }
}

async function resolveParentId(
  parentId: unknown,
  selfId?: string
): Promise<string | null> {
  if (!parentId || typeof parentId !== "string" || parentId.trim() === "") {
    return null;
  }
  if (selfId && parentId === selfId) {
    throw new ParentTooDeepError();
  }
  // Validate parent exists.
  const r = await query(
    "SELECT id, parent_id FROM categories WHERE id = $1 LIMIT 1",
    [parentId]
  );
  if (r.rows.length === 0) return null;
  // Reject 3-level nesting explicitly. The UI only ever offers root categories
  // as parent candidates, so this branch indicates either stale client state
  // (user resubmitted a payload with a sub-category as parent) or a bug.
  // Previously the code silently rewrote the chosen parent to the grandparent,
  // which produced data the admin never intended to save.
  if (r.rows[0].parent_id) {
    throw new ParentTooDeepError();
  }
  return r.rows[0].id;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_categories");
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query(
      `SELECT
         c.id,
         c.name_ar,
         c.name_en,
         c.slug,
         c.parent_id,
         c.sort_order,
         c.is_active,
         c.description_ar,
         c.description_en,
         c.icon_url,
         c.created_at,
         p.name_ar AS parent_name_ar,
         p.slug AS parent_slug,
         (SELECT COUNT(*) FROM products_unified pr WHERE pr.category_id = c.id) AS product_count,
         (SELECT COUNT(*) FROM categories cc WHERE cc.parent_id = c.id) AS child_count,
         COALESCE(
           CASE
             WHEN c.icon_url LIKE '/images/%'
               OR c.icon_url LIKE 'http://%'
               OR c.icon_url LIKE 'https://%'
               OR c.icon_url ~* '\\.(jpg|jpeg|png|webp|gif|svg)(\\?.*)?$'
             THEN c.icon_url
           END,
           fp.image_url
         ) AS effective_icon_url
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id
       LEFT JOIN LATERAL (
         SELECT p.image_url
         FROM products_unified p
         WHERE p.category_id = c.id
           AND p.image_url IS NOT NULL
           AND TRIM(p.image_url) <> ''
         ORDER BY p.is_active DESC, p.updated_at DESC NULLS LAST, p.id
         LIMIT 1
       ) fp ON true
       ORDER BY c.sort_order ASC, c.name_ar ASC`
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("GET categories error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب الفئات" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_categories");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const {
      name_ar,
      name_en,
      slug,
      icon_url,
      sort_order,
      parent_id,
      is_active,
      description_ar,
      description_en,
    } = body;
    if (!name_ar || typeof name_ar !== "string" || !name_ar.trim()) {
      return NextResponse.json(
        { success: false, error: "اسم الفئة بالعربية مطلوب" },
        { status: 400 }
      );
    }
    let resolvedParent: string | null;
    try {
      resolvedParent = await resolveParentId(parent_id);
    } catch (e) {
      if (e instanceof ParentTooDeepError) {
        return NextResponse.json(
          {
            success: false,
            error:
              "لا يمكن استخدام فئة فرعية كقسم أب. الفئات الفرعية من المستوى الثاني فقط مسموح بها كجذر.",
          },
          { status: 400 }
        );
      }
      throw e;
    }
    const rawSlug = (slug && slug.trim()) || generateSlug(name_ar);
    const finalSlug = await ensureSlugUnique(rawSlug);
    const finalIcon = icon_url && icon_url.trim() ? icon_url.trim() : null;
    const finalSort = parseInt(sort_order, 10) || 0;
    const finalActive = is_active !== false; // default true

    const result = await query(
      `INSERT INTO categories
        (name_ar, name_en, slug, parent_id, icon_url, sort_order, is_active, description_ar, description_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        name_ar.trim(),
        name_en?.trim() || null,
        finalSlug,
        resolvedParent,
        finalIcon,
        finalSort,
        finalActive,
        description_ar?.trim() || null,
        description_en?.trim() || null,
      ]
    );
    cache.invalidatePattern("categories:");
    return NextResponse.json({
      success: true,
      data: { id: result.rows[0].id, slug: finalSlug },
    });
  } catch (error) {
    logError("POST category error:", error);
    // Don't expose internal error details to client
    return NextResponse.json(
      { success: false, error: "فشل إنشاء الفئة" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_categories");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== "string") return idCheckResult;
    const body = await request.json();
    const {
      name_ar,
      name_en,
      slug,
      icon_url,
      sort_order,
      parent_id,
      is_active,
      description_ar,
      description_en,
    } = body;

    if (!name_ar || !name_ar.trim()) {
      return NextResponse.json(
        { success: false, error: "اسم الفئة بالعربية مطلوب" },
        { status: 400 }
      );
    }

    // Prevent setting self as parent (resolveParentId also covers this,
    // but we surface a friendlier Arabic message here).
    if (parent_id && parent_id === idCheckResult) {
      return NextResponse.json(
        { success: false, error: "لا يمكن أن تكون الفئة أباً لنفسها" },
        { status: 400 }
      );
    }

    let resolvedParent: string | null;
    try {
      resolvedParent = await resolveParentId(parent_id, idCheckResult);
    } catch (e) {
      if (e instanceof ParentTooDeepError) {
        return NextResponse.json(
          {
            success: false,
            error:
              "لا يمكن استخدام فئة فرعية كقسم أب. الفئات الفرعية من المستوى الثاني فقط مسموح بها كجذر.",
          },
          { status: 400 }
        );
      }
      throw e;
    }
    let finalSlug = slug && slug.trim() ? slug.trim() : generateSlug(name_ar);
    finalSlug = await ensureSlugUnique(finalSlug, idCheckResult);

    const result = await query(
      `UPDATE categories
         SET name_ar = $1,
             name_en = $2,
             slug = $3,
             parent_id = $4,
             icon_url = $5,
             sort_order = $6,
             is_active = $7,
             description_ar = $8,
             description_en = $9
       WHERE id = $10
       RETURNING id`,
      [
        name_ar.trim(),
        name_en?.trim() || null,
        finalSlug,
        resolvedParent,
        icon_url && icon_url.trim() ? icon_url.trim() : null,
        parseInt(sort_order, 10) || 0,
        is_active !== false,
        description_ar?.trim() || null,
        description_en?.trim() || null,
        idCheckResult,
      ]
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "الفئة غير موجودة" },
        { status: 404 }
      );
    }
    cache.invalidatePattern("categories:");
    return NextResponse.json({ success: true, data: { slug: finalSlug } });
  } catch (error) {
    logError("PUT category error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديث الفئة" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_categories");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== "string") return idCheckResult;

    // Two optional knobs let the admin choose how to deal with attached
    // products. The default (no flag) preserves the previous safe
    // behaviour — refuse if products exist — so any old client keeps
    // working.
    //
    //   ?with_products=true
    //       Cascade-delete every product in this category first
    //       (vendor_products rows go through CITY_MARKETS_VENDOR_ID scope,
    //       R2 cleanup runs after the SQL DELETE). Legacy `products`
    //       rows keep their data — the ON DELETE SET NULL FK from
    //       migration 055 nulls their category_id when the category
    //       drops, leaving the product itself intact.
    //
    //   ?move_to=<categoryUuid>
    //       Re-parent every product in this category to the given
    //       target category, then delete the source. The target must
    //       exist (and must not be a descendant of the source to avoid
    //       moving a parent under one of its own children).
    const withProducts = url.searchParams.get("with_products") === "true";
    const moveToRaw = url.searchParams.get("move_to");
    const moveTo = moveToRaw && UUID_LIKE.test(moveToRaw) ? moveToRaw : null;
    if (moveToRaw && !moveTo) {
      return NextResponse.json(
        { success: false, error: "الفئة المستهدفة غير صالحة" },
        { status: 400 },
      );
    }

    // Look up the source category once to validate it exists. We
    // additionally need its `parent_id` so we can re-parent children
    // on cascade (children get grandparented, then we delete the
    // source).
    const sourceRow = await query(
      "SELECT id, parent_id FROM categories WHERE id = $1",
      [idCheckResult],
    );
    if (sourceRow.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "الفئة غير موجودة" },
        { status: 404 },
      );
    }
    const sourceParentId = (sourceRow.rows[0].parent_id as string | null) ?? null;

    // Count products across both legacy + multi-vendor catalogs.
    const usageCheck = await query(
      "SELECT COUNT(*)::int AS cnt FROM products_unified WHERE category_id = $1",
      [idCheckResult],
    );
    const productCount = usageCheck.rows[0].cnt as number;

    // Default safe behaviour — preserves backward compatibility. Any
    // old client that does not pass a flag will still get the same
    // 409 error as before.
    if (productCount > 0 && !withProducts && !moveTo) {
      return NextResponse.json(
        {
          success: false,
          error:
            "لا يمكن الحذف: هناك منتجات مرتبطة بهذه الفئة. انقل المنتجات لقسم آخر أو اختر حذف القسم مع منتجاته.",
        },
        { status: 409 },
      );
    }

    // Resolve target category when moving — both existence and "not a
    // descendant of the source" checks.
    let moveTargetParent: string | null = null;
    if (moveTo) {
      if (moveTo === idCheckResult) {
        return NextResponse.json(
          { success: false, error: "لا يمكن نقل المنتجات لنفس الفئة" },
          { status: 400 },
        );
      }
      const targetRow = await query(
        "SELECT id, parent_id FROM categories WHERE id = $1",
        [moveTo],
      );
      if (targetRow.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: "الفئة المستهدفة غير موجودة" },
          { status: 404 },
        );
      }
      moveTargetParent = (targetRow.rows[0].parent_id as string | null) ?? null;

      // Cycle check: is the requested target a descendant of the source?
      // Skip when the source is already a direct ancestor (parent of the
      // source) — the simple case the caller most likely means.
      const cycle = await query(
        `WITH RECURSIVE descendants AS (
           SELECT id, parent_id FROM categories WHERE id = $1
           UNION ALL
           SELECT c.id, c.parent_id
             FROM categories c
             JOIN descendants d ON c.parent_id = d.id
         )
         SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
        [idCheckResult, moveTo],
      );
      if (cycle.rowCount && cycle.rowCount > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "الفئة المستهدفة فرع من هذه الفئة — لا يمكن النقل تحتها",
          },
          { status: 400 },
        );
      }
    }

    // === Run the requested action inside a transaction so a partial
    // failure never leaves the catalog half-moved.
    const client = await (await import("@/lib/db")).pool.connect();
    const txResult = await runCategoryDeleteTx(client, {
      sourceId: idCheckResult,
      sourceParentId,
      productCount,
      withProducts,
      moveTo,
    });
    client.release();
    if (txResult.ok) {
      return NextResponse.json({
        success: true,
        deletedProducts: txResult.deletedProducts,
        movedProducts: txResult.movedProducts,
        deletedImages: txResult.deletedImages,
      });
    }
    return NextResponse.json({ success: false, error: txResult.error }, { status: txResult.status });
  } catch (error) {
    logError("DELETE category error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف الفئة" },
      { status: 500 }
    );
  }
}

interface CategoryDeleteArgs {
  sourceId: string;
  sourceParentId: string | null;
  productCount: number;
  withProducts: boolean;
  moveTo: string | null;
}

interface CategoryDeleteResult {
  ok: boolean;
  status?: number;
  error?: string;
  deletedProducts?: number;
  movedProducts?: number;
  deletedImages?: number;
}

/**
 * Run the category delete + (optional) product reparent / product
 * cascade in a single transaction. Returns counts so the caller can
 * report what happened. R2 cleanup for cascaded vendor_products
 * images runs after the transaction commits.
 */
async function runCategoryDeleteTx(
  client: import("pg").PoolClient,
  args: CategoryDeleteArgs,
): Promise<CategoryDeleteResult> {
  const { sourceId, sourceParentId, productCount, withProducts, moveTo } = args;
  const orphanedUrls = new Set<string>();

  try {
    await client.query("BEGIN");

    // Snapshot product images for cleanup (only on cascade delete).
    if (withProducts && productCount > 0) {
      const vendor = await client.query<{ image_url: string | null; image_urls: string[] | null }>(
        `SELECT image_url, image_urls
           FROM vendor_products
          WHERE category_id = $1 AND vendor_id = $2`,
        [sourceId, CITY_MARKETS_VENDOR_ID],
      );
      for (const r of vendor.rows) {
        if (r.image_url) orphanedUrls.add(r.image_url);
        if (Array.isArray(r.image_urls)) {
          for (const u of r.image_urls) if (u) orphanedUrls.add(u);
        }
      }

      // Delete vendor_products first (FK from migration 010 / 054 is
      // SET NULL on order items, so this won't block). Legacy
      // `products` rows are deliberately left alone — migration 055
      // detaches them via the SET NULL FK when we drop the category
      // below.
      await client.query(
        `DELETE FROM vendor_products
          WHERE category_id = $1 AND vendor_id = $2`,
        [sourceId, CITY_MARKETS_VENDOR_ID],
      );
    } else if (moveTo) {
      // Move the live category_id reference for both catalogs. Legacy
      // `products` is SELECT-grant-only, so we update via the postgres
      // role's BYPASSRLS — which citymarket_user also has.
      await client.query(
        `UPDATE vendor_products
            SET category_id = $1
          WHERE category_id = $2 AND vendor_id = $3`,
        [moveTo, sourceId, CITY_MARKETS_VENDOR_ID],
      );
      await client.query(
        `UPDATE products
            SET category_id = $1
          WHERE category_id = $2`,
        [moveTo, sourceId],
      );
    }

    // Re-parent any sub-categories to the source's parent so the
    // tree stays consistent. If the source had no parent, the children
    // become roots (parent_id = NULL).
    await client.query(
      `UPDATE categories
          SET parent_id = $1
        WHERE parent_id = $2`,
      [sourceParentId, sourceId],
    );

    // Finally delete the source category itself.
    const del = await client.query(
      "DELETE FROM categories WHERE id = $1",
      [sourceId],
    );
    if (del.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "الفئة غير موجودة" };
    }

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    logError("Category delete transaction failed", e);
    return { ok: false, status: 500, error: "فشل حذف الفئة" };
  }

  // R2 cleanup runs after the transaction commits — fail-soft, never
  // roll back a successful delete because a CDN object couldn't be
  // deleted. Matches the pattern used by /api/admin/products DELETE.
  let deletedImages = 0;
  for (const url of orphanedUrls) {
    const key = r2KeyFromUrl(url);
    if (!key) continue;
    try {
      await deleteFromR2(key);
      deletedImages++;
    } catch (r2Err) {
      logWarn("R2 delete on category cascade failed", {
        categoryId: sourceId,
        key,
        error: r2Err instanceof Error ? r2Err.message : String(r2Err),
      });
    }
  }

  cache.invalidatePattern("categories:");
  return {
    ok: true,
    deletedProducts: withProducts ? productCount : 0,
    movedProducts: moveTo ? productCount : 0,
    deletedImages,
  };
}