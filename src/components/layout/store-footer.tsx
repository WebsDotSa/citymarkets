import { headers } from "next/headers";
import { FooterV2 } from "./footer-v2";
import { isStoreFooterRoute } from "@/lib/app-routes";

/**
 * Footer wrapper that mirrors the StoreChrome pattern: hidden on
 * /admin and /vendor routes where the marketing footer would leak
 * into dashboards. Reads pathname from the x-pathname header that
 * proxy.ts forwards on every request.
 */
export async function StoreFooter() {
  const pathname = (await headers()).get("x-pathname") || "";
  if (!isStoreFooterRoute(pathname)) return null;
  return <FooterV2 />;
}