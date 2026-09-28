export type SocialPlatform =
  | "tiktok"
  | "x"
  | "snapchat"
  | "instagram"
  | "whatsapp";

export interface SocialLink {
  platform: SocialPlatform;
  label: string;
  href: string;
  handle: string;
}

/**
 * Central source of truth for the brand's social profiles.
 * Every channel ever shown to users (footer, landing-page, JSON-LD, etc.)
 * must read from this list — do not hardcode URLs elsewhere.
 *
 * Last reviewed: 2026-08-17
 */
export const SOCIAL_LINKS: SocialLink[] = [
  {
    platform: "tiktok",
    label: "TikTok",
    href: "https://www.tiktok.com/@city_markets",
    handle: "@city_markets",
  },
  {
    platform: "x",
    label: "X (تويتر)",
    href: "https://x.com/city_markets1",
    handle: "@city_markets1",
  },
  {
    platform: "snapchat",
    label: "Snapchat",
    href: "https://www.snapchat.com/@city_markets",
    handle: "@city_markets",
  },
  {
    platform: "instagram",
    label: "Instagram",
    href: "https://www.instagram.com/city_markets1",
    handle: "@city_markets1",
  },
  {
    platform: "whatsapp",
    label: "قناة واتساب",
    href: "https://whatsapp.com/channel/0029VaymYvI0AgWFRcbxkk3Y",
    handle: "القناة",
  },
];

/**
 * Convenience selectors so callers don't have to re-derive the URL.
 */
export const SOCIAL_HREFS: Record<SocialPlatform, string> = SOCIAL_LINKS.reduce(
  (acc, link) => {
    acc[link.platform] = link.href;
    return acc;
  },
  {} as Record<SocialPlatform, string>,
);

export const STORE_PHONE_E164 = "+966530444976";
export const STORE_PHONE_DISPLAY = "+966 53 044 4976";
export const STORE_ADDRESS_AR = "التراث - حي الندوة، الرياض 11461";

