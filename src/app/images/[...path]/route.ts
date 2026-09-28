import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Dynamically serve uploaded images that aren't in the Next.js build manifest
// In Next.js production, public/ is read at build time. New uploads won't be served
// unless we explicitly read them at runtime.
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const segments = pathSegments || [];
    if (segments.length === 0) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Sanitize: prevent path traversal
    const safeSegments = segments.filter(
      (s) => !s.includes("..") && !s.startsWith(".")
    );
    if (safeSegments.length !== segments.length) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const relativePath = safeSegments.join("/");
    const filePath = path.join(process.cwd(), "public", "images", relativePath);

    // Verify the resolved path is inside public/images
    const imagesRoot = path.resolve(process.cwd(), "public", "images");
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(imagesRoot + path.sep)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return new NextResponse("Not found", { status: 404 });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

    // Stream file to response
    const stream = fs.createReadStream(resolvedPath);
    // Convert Node.js ReadStream to Web ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": stat.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    logError("Image serve error", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}