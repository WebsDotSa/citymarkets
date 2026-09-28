import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { error as logError } from "@/lib/logger";

/**
 * GET /api/admin/activity
 *
 * Query params (all optional):
 *   - admin_email: substring match against admin_audit_logs.admin_email
 *   - action: substring match against action (e.g. "store", "product")
 *   - entity_type: exact match (e.g. "store", "order")
 *   - from / to: ISO timestamps for created_at range filtering
 *   - limit: max rows (default 100, capped at 500)
 *   - offset: for pagination (default 0)
 *   - format: "json" (default) or "csv" — CSV returns the visible columns
 *            as a downloadable file for offline analysis / archival.
 *
 * Auth: requires the `view_activity` permission (super_admin / admin).
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_activity");
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(request.url);
    const adminEmail = url.searchParams.get("admin_email")?.trim();
    const action = url.searchParams.get("action")?.trim();
    const entityType = url.searchParams.get("entity_type")?.trim();
    const from = url.searchParams.get("from")?.trim();
    const to = url.searchParams.get("to")?.trim();
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const format = url.searchParams.get("format") || "json";

    // Build the WHERE clause from user filters. Each filter contributes one
    // parameter; we keep the predicates small and let the existing
    // idx_admin_audit_created / idx_admin_audit_admin indexes cover the
    // common paths (created_at DESC + admin_email equality).
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (adminEmail) {
      params.push(`%${adminEmail}%`);
      conditions.push(`admin_email ILIKE $${params.length}`);
    }
    if (action) {
      params.push(`%${action}%`);
      conditions.push(`action ILIKE $${params.length}`);
    }
    if (entityType) {
      params.push(entityType);
      conditions.push(`entity_type = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`created_at <= $${params.length}`);
    }
    const whereSQL =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const dataParams = [...params, limit, offset];
    const result = await query(
      `SELECT id, admin_id, admin_email, admin_name, action, entity_type, entity_id,
              details, ip_address, created_at
         FROM admin_audit_logs
         ${whereSQL}
         ORDER BY created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    // Total count for pagination UI. Run as a separate query so we can keep
    // the LIMIT/OFFSET on the data query without a window function cost on
    // every page load.
    const countParams = params;
    const countResult = await query(
      `SELECT COUNT(*)::int as total FROM admin_audit_logs ${whereSQL}`,
      countParams
    );
    const total = countResult.rows[0]?.total ?? 0;

    if (format === "csv") {
      // CSV export — admins use this for compliance/audit archival. We
      // intentionally exclude `details` (JSONB) because some payloads
      // include commas / newlines that would corrupt the CSV shape; admins
      // who need the details can drill into a specific row in the UI.
      const csvHeader =
        "id,admin_email,admin_name,action,entity_type,entity_id,ip_address,created_at\n";
      const csvRows = result.rows
        .map((r: any) =>
          [
            r.id,
            csvEscape(r.admin_email),
            csvEscape(r.admin_name),
            csvEscape(r.action),
            csvEscape(r.entity_type),
            csvEscape(r.entity_id),
            csvEscape(r.ip_address),
            new Date(r.created_at).toISOString(),
          ].join(",")
        )
        .join("\n");
      const filename = `admin-activity-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      return new NextResponse(csvHeader + csvRows + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      },
    });
  } catch (error) {
    logError("activity GET:", error);
    return NextResponse.json({ success: false, error: "فشل جلب السجل" }, { status: 500 });
  }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // SECURITY (F10): CSV formula injection guard. Cells starting with
  // =, +, -, @, TAB, or CR are interpreted as formulas by Excel /
  // Numbers / Sheets and execute on open. Prefix with a single quote
  // to neutralise them while keeping the original visible to humans.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  // Quote any value containing comma, quote, or newline; double internal quotes.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}