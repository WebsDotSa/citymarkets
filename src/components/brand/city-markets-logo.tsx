import Image from "next/image";
import Link from "next/link";

/** Official horizontal logo (300×120 source) */
export const CITY_MARKETS_LOGO_ASPECT = 300 / 120;

const LOGO_SRC = "/images/city-markets-logo.png";

type CityMarketsLogoProps = {
  height?: number;
  className?: string;
  /**
   * Target URL for the optional link wrapper. Defaults to `"/"`.
   * Pass an empty string or omit with `link={false}` to render without a link.
   */
  href?: string;
  /**
   * When false, the logo is rendered as a plain inline element with no anchor.
   * Defaults to true so existing callers that only pass `height` keep linking.
   */
  link?: boolean;
  priority?: boolean;
};

export function CityMarketsLogo({
  height = 28,
  className = "",
  href = "/",
  link = true,
  priority = false,
}: CityMarketsLogoProps) {
  const width = Math.round(height * CITY_MARKETS_LOGO_ASPECT);

  const logo = (
    <Image
      src={LOGO_SRC}
      alt="أسواق سيتي — City Markets"
      width={width}
      height={height}
      priority={priority}
      className={`block h-auto w-auto max-w-full object-contain object-right flex-shrink-0 ${className}`}
      style={{ height, width: "auto", maxWidth: "min(100%, 360px)" }}
    />
  );

  if (!link) {
    return <span className="inline-flex items-center justify-center">{logo}</span>;
  }

  return (
    <Link href={href} className="inline-flex items-center justify-center">
      {logo}
    </Link>
  );
}