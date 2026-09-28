import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { COOKIE_NAME, verifyCustomerToken } from "@/lib/customer-session";
import { mapDbUserRow } from "@/lib/map-db-user";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const payload = await verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const row = await client.query(
      `SELECT id, phone, name, email, avatar_url, loyalty_points, loyalty_tier,
              spin_count_today, last_spin_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [payload.userId]
    );
    if (row.rows.length === 0) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({ user: mapDbUserRow(row.rows[0]) });
  } finally {
    client.release();
  }
}
