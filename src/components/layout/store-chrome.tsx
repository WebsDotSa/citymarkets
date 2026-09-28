import { headers } from "next/headers";
import { HeaderV2 } from "@/components/layout/header-v2";
import { BottomNavV2 } from "@/components/layout/bottom-nav-v2";
import { StickyCartBar } from "@/components/storefront/sticky-cart-bar";
import { QuickOrderFab } from "@/components/layout/quick-order-fab";
import { isStorefrontRoute } from "@/lib/app-routes";

export async function StoreChrome() {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") || "";
  if (!pathname) return null;
  if (!isStorefrontRoute(pathname)) return null;

  // HeaderV2 + StickyCartBar are shown on every storefront route
  // including /ai-chat so users always have global nav, logo, and
  // the cart button while chatting. BottomNavV2 is also kept so
  // users can navigate away from the chat quickly.
  return (
    <>
      <HeaderV2 />
      <StickyCartBar />
      <BottomNavV2 />
      <QuickOrderFab />
    </>
  );
}