import { NextResponse } from "next/server";
import { COOKIE_NAME, customerSessionCookieOptions } from '@/lib/identity';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", {
    ...customerSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}
