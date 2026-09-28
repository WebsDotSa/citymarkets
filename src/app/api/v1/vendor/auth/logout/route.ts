import { NextResponse } from "next/server";
import {
  VENDOR_SESSION_COOKIE,
  vendorSessionCookieOptions,
} from "@/lib/vendor-auth";

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(VENDOR_SESSION_COOKIE, "", {
    ...vendorSessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}
