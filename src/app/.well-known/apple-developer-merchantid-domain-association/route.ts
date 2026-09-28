import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const FILE_NAME = "apple-developer-merchantid-domain-association";

async function readDomainAssociationFile(): Promise<string | null> {
  const candidates = [
    process.env.APPLE_PAY_DOMAIN_ASSOCIATION_PATH,
    path.join(process.cwd(), "public", ".well-known", FILE_NAME),
    path.join(process.cwd(), ".well-known", FILE_NAME),
    path.join(process.cwd(), FILE_NAME),
  ].filter((p): p is string => Boolean(p?.trim()));

  for (const filePath of candidates) {
    try {
      const body = await readFile(filePath, "utf8");
      const trimmed = body.trim();
      if (trimmed.length > 0) return trimmed;
    } catch {
      /* try next path */
    }
  }
  return null;
}

export async function GET() {
  const body = await readDomainAssociationFile();
  if (!body) {
    return new NextResponse("Apple Pay domain verification file is not configured", {
      status: 404,
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
