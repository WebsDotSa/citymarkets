import { NextResponse } from "next/server";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);

    if (!session) {
      return NextResponse.json(
        { error: "غير مصرح" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: session.staffId,
        email: session.email,
        fullName: session.fullName,
        role: session.role,
        permissions: session.permissions,
        vendor: {
          id: session.vendorId,
          slug: session.vendorSlug,
        },
      },
    });
  } catch (error) {
    logError("Vendor /me error:", error);
    return NextResponse.json(
      { error: "حدث خطأ" },
      { status: 500 }
    );
  }
}
