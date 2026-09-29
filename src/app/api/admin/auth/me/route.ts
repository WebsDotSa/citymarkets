import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from '@/lib/identity';
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await verifyAdminRequest(request);
  if (!session) {
    return NextResponse.json(
      { success: false, authenticated: false },
      { status: 401 }
    );
  }

  try {
    const result = await query(
      `SELECT id, name, email, role FROM admin_users WHERE id = $1 AND is_active = true`,
      [session.id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, authenticated: false },
        { status: 401 }
      );
    }
    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      authenticated: true,
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "خطأ في الخادم" },
      { status: 500 }
    );
  }
}
