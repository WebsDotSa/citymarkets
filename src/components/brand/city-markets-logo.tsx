import Image from "next/image";
import Link from "next/link";

/** Official horizontal logo (300×120 source) */
export const CITY_MARKETS_LOGO_ASPECT = 300 / 120;

const LOGO_SRC = "/images/city-markets-logo.png";

type CityMarketsLogoProps = {
  height?: number;
  className?: string;
  href?: string | null;
  priority?: boolean;
};

export function CityMarketsLogo({
  height = 28,
  className = "",
  href = "/",
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

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center justify-center">
        {logo}
      </Link>
    );
  }

  return <span className="inline-flex items-center justify-center">{logo}</span>;
}
