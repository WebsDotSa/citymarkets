/**
 * Renderer registry for home layout sections.
 *
 * Each renderer is a small client component that fetches whatever data
 * it needs from existing public APIs and maps it onto the existing
 * storefront components (ProductCard, OfferCard, HeroBanner, etc).
 *
 * Renderers return `null` when their data is empty so the layout
 * gracefully degrades (matches the existing `*Section` pattern).
 *
 * Renderers intentionally do NOT fetch the same data twice if they're
 * already cached in the parent — each is self-contained and SSR-friendly.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Sparkles, Zap, Flame, Store, TicketPercent, Megaphone, FileText } from "lucide-react";
import { HeroBanner, StaticHero, PromoStrip } from "@/components/design/hero-banner";
import { CategoryCard } from "@/components/design/category-card";
import { ProductCard } from "@/components/storefront/product-card";
import { OfferCard, type OfferCardData } from "@/components/storefront/offer-card";
import { OfferCountdown } from "@/components/storefront/offer-countdown";
import { apiFetch } from '@/lib/catalog';
import { sanitizeHtml } from '@/lib/sanitize-html';
import type {
  BannersSettings,
  CategoriesSettings,
  CategorySectionSettings,
  CtaSettings,
  CouponsSettings,
  HtmlBlockSettings,
  InlineBannerItem,
  LightningDealsSettings,
  OffersGridSettings,
  OffersStripSettings,
  ProductSource,
  ProductsSettings,
  Section,
  StoresSettings,
} from '@/lib/catalog';

// ─── helpers ─────────────────────────────────────────────────────

function bannerHref(item: InlineBannerItem): string | null {
  if (!item.link_type || item.link_type === "none") return null;
  const v = item.link_value ?? null;
  if (!v) return null;
  switch (item.link_type) {
    case "category":
      return `/categories/${v}`;
    case "product":
      return `/products/${v}`;
    case "vendor":
      // Public storefront route is `/vendors/<slug>`; `/vendor/*` is the vendor-admin
      // subtree and middleware redirects unauthenticated visitors there to login.
      return `/vendors/${v}`;
    case "external":
      return v;
    default:
      return null;
  }
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ─── banners ────────────────────────────────────────────────────

export function BannersRenderer({ settings }: { settings: BannersSettings }) {
  const { layout, aspect_ratio, height, auto_play, show_dots, banners } = settings;
  if (!banners || banners.length === 0) return null;

  if (layout === "grid_2" || layout === "grid_3") {
    const cols = layout === "grid_2" ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
    return (
      <div className={cn("px-4", "sm:px-6")}>
        <div className={cn("grid gap-3", cols)}>
          {banners.map((b, i) => (
            <BannerTile key={b.id ?? i} item={b} />
          ))}
        </div>
      </div>
    );
  }

  if (layout === "tall" || layout === "wide") {
    return (
      <div className="px-4 sm:px-6">
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-2xl",
            layout === "tall" ? "aspect-[3/4] max-w-md mx-auto" : "aspect-[21/9]",
          )}
          style={height && !aspect_ratio ? { height } : undefined}
        >
          <BannerImage item={banners[0]} priority />
        </div>
      </div>
    );
  }

  // carousel
  return (
    <div className="px-4 sm:px-6">
      <HeroBanner
        banners={banners.map((b) => ({
          id: b.id ?? b.image_url,
          image_url: b.image_url,
          link_type: b.link_type,
          link_value: b.link_value ?? null,
        }))}
      />
    </div>
  );
}

function BannerTile({ item, priority }: { item: InlineBannerItem; priority?: boolean }) {
  const href = bannerHref(item);
  const inner = (
    <div className="relative w-full aspect-[16/9] overflow-hidden rounded-xl bg-gray-100">
      <BannerImage item={item} priority={priority} />
      {(item.title_ar || item.subtitle_ar) && (
        <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/60 to-transparent text-white">
          {item.title_ar && <p className="text-sm font-bold">{item.title_ar}</p>}
          {item.subtitle_ar && <p className="text-xs opacity-90">{item.subtitle_ar}</p>}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function BannerImage({ item, priority }: { item: InlineBannerItem; priority?: boolean }) {
  return (
    <Image
      src={item.image_url}
      alt={item.title_ar ?? "banner"}
      fill
      priority={priority}
      className="object-cover"
      sizes="(max-width: 768px) 100vw, 50vw"
    />
  );
}

// ─── categories ─────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  name_ar: string;
  slug: string;
  icon_url?: string | null;
  emoji?: string | null;
  parent_id?: string | null;
}

export function CategoriesRenderer({ settings }: { settings: CategoriesSettings }) {
  const { title, columns, max_items, root_only, background_color, show_icons } = settings;
  const [cats, setCats] = useState<CategoryRow[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    apiFetch<CategoryRow[]>("/api/v1/categories", { signal: ac.signal })
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          let list = res.data;
          if (root_only) list = list.filter((c) => !c.parent_id);
          setCats(list.slice(0, max_items ?? 12));
        } else {
          setCats([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setCats([]);
      });
    return () => ac.abort();
  }, [max_items, root_only]);

  if (!cats || cats.length === 0) return null;

  const colsClass =
    {
      3: "grid-cols-3",
      4: "grid-cols-4",
      5: "grid-cols-5",
      6: "grid-cols-6",
      7: "grid-cols-7",
      8: "grid-cols-8",
    }[Math.min(8, Math.max(3, columns))] ?? "grid-cols-4";

  return (
    <section className="px-4 sm:px-6 mt-6" style={background_color ? { backgroundColor: background_color } : undefined}>
      {title && <h2 className="text-lg font-bold text-secondary mb-3">{title}</h2>}
      <div className={cn("grid gap-3", colsClass)}>
        {cats.map((c) => (
          <CategoryCard
            key={c.id}
            id={c.id}
            name_ar={c.name_ar}
            slug={c.slug}
            icon_url={show_icons ? c.icon_url : undefined}
            emoji={c.emoji ?? undefined}
          />
        ))}
      </div>
    </section>
  );
}

// ─── products ───────────────────────────────────────────────────

interface Product {
  id: string;
  name_ar: string;
  image_url?: string | null;
  price?: number;
  discount_price?: number | null;
  barcode?: string;
  unit?: string | null;
}

export function ProductsRenderer({ settings }: { settings: ProductsSettings }) {
  const { title, subtitle, source, product_ids, category_id, limit, display, columns, background_color, cta_text, cta_link } =
    settings;
  const [items, setItems] = useState<Product[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const fetchBySource = async () => {
      let url = "";
      switch (source) {
        case "featured":
          url = `/api/v1/products?featured=true&limit=${limit}`;
          break;
        case "best_selling":
          url = `/api/v1/products?sort=best_selling&limit=${limit}`;
          break;
        case "on_offer":
          url = `/api/v1/products?on_offer=true&limit=${limit}`;
          break;
        case "new":
          url = `/api/v1/products?new=true&limit=${limit}`;
          break;
        case "custom":
          url = `/api/v1/products?ids=${(product_ids ?? []).join(",")}&limit=${limit}`;
          break;
      }
      try {
        const res = await apiFetch<Product[] | { data: Product[] }>(url, { signal: ac.signal });
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setItems(list);
        } else {
          setItems([]);
        }
      } catch {
        if (!ac.signal.aborted) setItems([]);
      }
    };
    fetchBySource();
    return () => ac.abort();
  }, [source, product_ids, limit]);

  if (!items || items.length === 0) return null;

  const isCarousel = display === "carousel";
  const colsClass =
    {
      2: "grid-cols-2",
      3: "grid-cols-2 sm:grid-cols-3",
      4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
      5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
      6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6",
    }[Math.min(6, Math.max(2, columns ?? 4))] ?? "grid-cols-4";

  return (
    <section
      className="mt-6"
      style={background_color ? { backgroundColor: background_color } : undefined}
    >
      <div className="px-4 sm:px-6 flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-secondary">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {cta_text && cta_link && (
          <Link href={cta_link} className="text-sm font-semibold text-primary hover:underline">
            {cta_text} ←
          </Link>
        )}
      </div>
      <div
        className={cn(
          isCarousel
            ? "flex gap-3 overflow-x-auto px-4 sm:px-6 pb-4 scrollbar-hide"
            : cn("grid gap-3 px-4 sm:px-6", colsClass),
        )}
        style={isCarousel ? { scrollSnapType: "x mandatory" } : undefined}
      >
        {items.map((p) => (
          <div
            key={p.id}
            className={isCarousel ? "w-44 sm:w-56 flex-shrink-0" : undefined}
            style={isCarousel ? { scrollSnapAlign: "start" } : undefined}
          >
            <ProductCard product={p as never} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── offers grid ────────────────────────────────────────────────

export function OffersGridRenderer({ settings }: { settings: OffersGridSettings }) {
  const { title, subtitle, limit, display, columns, background_color, cta_text, cta_link } = settings;
  const [offers, setOffers] = useState<OfferCardData[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    apiFetch<OfferCardData[] | { data: OfferCardData[] }>(
      `/api/v1/offers?featured=true&limit=${limit}`,
      { signal: ac.signal },
    )
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setOffers(list);
        } else {
          setOffers([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setOffers([]);
      });
    return () => ac.abort();
  }, [limit]);

  if (!offers || offers.length === 0) return null;

  const colsClass =
    {
      2: "grid-cols-1 sm:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-2 lg:grid-cols-4",
    }[Math.min(4, Math.max(2, columns ?? 3))] ?? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return (
    <section
      className="mt-6"
      style={background_color ? { backgroundColor: background_color } : undefined}
    >
      <div className="px-4 sm:px-6 flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-secondary flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            {title}
          </h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {cta_text && cta_link && (
          <Link href={cta_link} className="text-sm font-semibold text-primary hover:underline">
            {cta_text} ←
          </Link>
        )}
      </div>
      <div className={cn("grid gap-3 px-4 sm:px-6", colsClass)}>
        {offers.map((o) => (
          <OfferCard key={o.id} offer={o} variant={display === "carousel" ? "hero" : "standard"} />
        ))}
      </div>
    </section>
  );
}

// ─── offers strip (لا يفوتك) ────────────────────────────────────

export function OffersStripRenderer({ settings }: { settings: OffersStripSettings }) {
  const { title, subtitle, banners, background_color, text_color, countdown_enabled } = settings;
  if (!banners || banners.length === 0) return null;

  return (
    <section
      className="mt-6 py-4"
      style={{
        backgroundColor: background_color ?? "#7c2d12",
        color: text_color ?? "#ffffff",
      }}
    >
      <div className="px-4 sm:px-6 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5" />
          <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
        </div>
        {subtitle && <p className="text-xs opacity-90">{subtitle}</p>}
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 pb-2 scrollbar-hide">
        {banners.map((b, i) => {
          const href = bannerHref(b);
          const inner = (
            <div className="relative w-64 sm:w-72 h-32 rounded-xl overflow-hidden bg-black/20 flex-shrink-0">
              <Image
                src={b.image_url}
                alt={b.title_ar ?? "offer"}
                fill
                className="object-cover"
                sizes="300px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-3">
                {b.discount_label && (
                  <span className="inline-block bg-amber-400 text-black text-xs font-bold px-2 py-0.5 rounded">
                    {b.discount_label}
                  </span>
                )}
                {b.title_ar && <p className="text-white text-sm font-bold mt-1">{b.title_ar}</p>}
                {countdown_enabled && b.ends_at && (
                  <OfferCountdown
                    endsAt={b.ends_at}
                    variant="compact"
                    className="text-white mt-1"
                  />
                )}
              </div>
            </div>
          );
          return href ? (
            <Link key={b.id ?? i} href={href} className="block flex-shrink-0">
              {inner}
            </Link>
          ) : (
            <div key={b.id ?? i}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

// ─── lightning deals (عروض برق) ─────────────────────────────────

export function LightningDealsRenderer({ settings }: { settings: LightningDealsSettings }) {
  const {
    title,
    subtitle,
    background_color,
    header_color,
    border_color,
    footer_text,
    footer_link,
    ends_at,
    product_source,
    limit,
    show_countdown,
  } = settings;
  const [items, setItems] = useState<Product[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const url =
      product_source === "on_offer"
        ? `/api/v1/products?on_offer=true&limit=${limit ?? 6}`
        : `/api/v1/products?ids=&limit=${limit ?? 6}`;
    apiFetch<Product[] | { data: Product[] }>(url, { signal: ac.signal })
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setItems(list);
        } else {
          setItems([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      });
    return () => ac.abort();
  }, [product_source, limit]);

  if (!items || items.length === 0) return null;

  return (
    <section
      className="mt-6 mx-4 sm:mx-6 rounded-2xl p-4 border-2"
      style={{
        backgroundColor: background_color ?? "#fef3c7",
        borderColor: border_color ?? "#fbbf24",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5" style={{ color: header_color ?? "#92400e" }} />
          <h2 className="text-lg sm:text-xl font-bold" style={{ color: header_color ?? "#92400e" }}>
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs opacity-70" style={{ color: header_color ?? "#92400e" }}>
              {subtitle}
            </span>
          )}
        </div>
        {show_countdown && (
          <OfferCountdown endsAt={ends_at} className="text-sm" />
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((p) => (
          <ProductCard key={p.id} product={p as never} />
        ))}
      </div>
      {footer_text && footer_link && (
        <div className="text-center mt-4">
          <Link
            href={footer_link}
            className="inline-block px-6 py-2 bg-white rounded-full text-sm font-semibold hover:bg-gray-50"
            style={{ color: header_color ?? "#92400e" }}
          >
            {footer_text} ←
          </Link>
        </div>
      )}
    </section>
  );
}

// ─── category section ───────────────────────────────────────────

export function CategorySectionRenderer({ settings }: { settings: CategorySectionSettings }) {
  const { category_id, title_override, background_color, layout, limit } = settings;
  const [items, setItems] = useState<Product[] | null>(null);
  const [title, setTitle] = useState<string | null>(title_override ?? null);

  useEffect(() => {
    if (!category_id) return;
    const ac = new AbortController();
    apiFetch<{ data: Product[] } | Product[]>(
      `/api/v1/products?category=${category_id}&limit=${limit ?? 8}`,
      { signal: ac.signal },
    )
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setItems(list);
        } else {
          setItems([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      });
    if (!title_override) {
      apiFetch<{ data: CategoryRow[] } | CategoryRow[]>("/api/v1/categories", { signal: ac.signal })
        .then((res) => {
          if (res.success && res.data) {
            const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
            const found = list.find((c) => c.id === category_id);
            if (found) setTitle(found.name_ar);
          }
        })
        .catch(() => {});
    }
    return () => ac.abort();
  }, [category_id, limit, title_override]);

  if (!items || items.length === 0) return null;

  return (
    <section
      className="mt-6"
      style={background_color ? { backgroundColor: background_color } : undefined}
    >
      <div className="px-4 sm:px-6 mb-3 flex items-center justify-between">
        <h2 className="text-lg sm:text-xl font-bold text-secondary">{title ?? "المنتجات"}</h2>
        <Link
          href={`/categories/${category_id}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          عرض الكل ←
        </Link>
      </div>
      <div
        className={cn(
          layout === "list"
            ? "flex flex-col gap-3 px-4 sm:px-6"
            : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-4 sm:px-6",
        )}
      >
        {items.map((p) => (
          <ProductCard key={p.id} product={p as never} />
        ))}
      </div>
    </section>
  );
}

// ─── stores ─────────────────────────────────────────────────────

interface HomeVendor {
  id: string;
  name_ar: string;
  slug?: string;
  logo_url?: string | null;
  cover_url?: string | null;
  description_ar?: string | null;
}

export function StoresRenderer({ settings }: { settings: StoresSettings }) {
  const { title, subtitle, limit, featured_only, display } = settings;
  const [stores, setStores] = useState<HomeVendor[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const url = `/api/v1/vendors?featured=${featured_only ? "true" : ""}&limit=${limit ?? 8}`;
    apiFetch<HomeVendor[] | { data: HomeVendor[] }>(url, { signal: ac.signal })
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setStores(list);
        } else {
          setStores([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setStores([]);
      });
    return () => ac.abort();
  }, [limit, featured_only]);

  if (!stores || stores.length === 0) return null;

  return (
    <section className="mt-6 px-4 sm:px-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-primary" />
          <h2 className="text-lg sm:text-xl font-bold text-secondary">{title}</h2>
        </div>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div
        className={cn(
          display === "carousel"
            ? "flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
            : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3",
        )}
      >
        {stores.map((s) => (
          <Link
            key={s.id}
            href={`/vendors/${s.slug ?? s.id}`}
            className={cn(
              "rounded-2xl bg-white border border-gray-100 overflow-hidden hover:shadow-md transition-shadow",
              display === "carousel" ? "w-40 sm:w-48 flex-shrink-0" : "",
            )}
          >
            {s.cover_url ? (
              <div className="relative w-full aspect-video bg-gray-100">
                <Image src={s.cover_url} alt={s.name_ar} fill className="object-cover" sizes="200px" />
              </div>
            ) : (
              <div className="w-full aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Store className="w-10 h-10 text-primary/50" />
              </div>
            )}
            <div className="p-3">
              <p className="font-semibold text-sm truncate">{s.name_ar}</p>
              {s.description_ar && <p className="text-xs text-gray-500 line-clamp-2">{s.description_ar}</p>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── coupons ────────────────────────────────────────────────────

interface Coupon {
  id: string;
  code: string;
  description_ar?: string;
  discount_label?: string;
  expires_at?: string;
}

export function CouponsRenderer({ settings }: { settings: CouponsSettings }) {
  const { title, limit, display } = settings;
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    apiFetch<Coupon[] | { data: Coupon[] }>(`/api/v1/coupons?limit=${limit ?? 6}`, {
      signal: ac.signal,
    })
      .then((res) => {
        if (res.success && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
          setCoupons(list);
        } else {
          setCoupons([]);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setCoupons([]);
      });
    return () => ac.abort();
  }, [limit]);

  if (!coupons || coupons.length === 0) return null;

  return (
    <section className="mt-6 px-4 sm:px-6">
      <div className="flex items-center gap-2 mb-3">
        <TicketPercent className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold">{title ?? "كوبونات حصرية"}</h2>
      </div>
      <div
        className={cn(
          display === "grid"
            ? "grid grid-cols-2 sm:grid-cols-3 gap-3"
            : "flex gap-3 overflow-x-auto pb-2 scrollbar-hide",
        )}
      >
        {coupons.map((c) => (
          <div
            key={c.id}
            className={cn(
              "rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-3",
              display === "strip" ? "w-48 sm:w-56 flex-shrink-0" : "",
            )}
          >
            <p className="font-mono font-bold text-amber-900">{c.code}</p>
            {c.discount_label && (
              <p className="text-sm text-amber-700 mt-1">{c.discount_label}</p>
            )}
            {c.description_ar && (
              <p className="text-xs text-amber-800 mt-1 line-clamp-2">{c.description_ar}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── html block ─────────────────────────────────────────────────

export function HtmlBlockRenderer({ settings }: { settings: HtmlBlockSettings }) {
  const { content_html, background_color, text_color } = settings;
  if (!content_html) return null;
  return (
    <section
      className="mt-6 px-4 sm:px-6"
      style={{
        backgroundColor: background_color ?? "#f1f5f9",
        color: text_color ?? "#0f172a",
      }}
    >
      <div
        className="py-4 prose prose-sm max-w-none"
        // Admin-only block. Defense-in-depth: render through the central
        // allowlist sanitizer so any direct-SQL write, future importer,
        // or compromised admin form cannot smuggle <iframe>/<object>/
        // <svg onload>/javascript: URIs past the render boundary.
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content_html) }}
      />
    </section>
  );
}

// ─── hero banner ────────────────────────────────────────────────

export function HeroBannerRenderer({ settings }: { settings: import("@/lib/catalog").HeroBannerSettings }) {
  // Simple static hero with optional banner image — keeps parity with
  // the existing PromoStrip / StaticHero primitives.
  return (
    <section
      className="mt-4 px-4 sm:px-6"
      style={
        settings.background_color ? { backgroundColor: settings.background_color } : undefined
      }
    >
      <StaticHero
        title={settings.title_ar ?? "مرحباً بك"}
        subtitle={settings.subtitle_ar ?? ""}
        ctaLabel="تسوّق الآن"
        ctaHref="/catalog"
      />
      <PromoStrip />
    </section>
  );
}

// ─── cta ────────────────────────────────────────────────────────

export function CtaRenderer({ settings }: { settings: CtaSettings }) {
  const { variant, title, subtitle, cta_text, cta_href, background_color, text_color } = settings;
  return (
    <section
      className="mt-6 mx-4 sm:mx-6 rounded-2xl p-6 text-center"
      style={{
        backgroundColor: background_color ?? "#0f172a",
        color: text_color ?? "#ffffff",
      }}
    >
      <div className="flex items-center justify-center gap-2 mb-2">
        {variant === "join" ? <Megaphone className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </div>
      <h2 className="text-lg sm:text-xl font-bold">{title ?? (variant === "join" ? "انضم إلينا" : "كن شريكاً")}</h2>
      {subtitle && <p className="text-sm opacity-90 mt-1">{subtitle}</p>}
      {cta_text && cta_href && (
        <Link
          href={cta_href}
          className="inline-block mt-4 px-6 py-2 bg-white text-secondary rounded-full text-sm font-semibold hover:bg-gray-100"
        >
          {cta_text}
        </Link>
      )}
    </section>
  );
}

// ─── registry ───────────────────────────────────────────────────

export function renderSection(section: Section): React.ReactNode {
  if (!section.visible) return null;
  switch (section.type) {
    case "hero_banner":
      return <HeroBannerRenderer settings={section.settings} />;
    case "banners":
      return <BannersRenderer settings={section.settings} />;
    case "categories":
      return <CategoriesRenderer settings={section.settings} />;
    case "products":
      return <ProductsRenderer settings={section.settings} />;
    case "offers_grid":
      return <OffersGridRenderer settings={section.settings} />;
    case "offers_strip":
      return <OffersStripRenderer settings={section.settings} />;
    case "lightning_deals":
      return <LightningDealsRenderer settings={section.settings} />;
    case "category_section":
      return <CategorySectionRenderer settings={section.settings} />;
    case "stores":
      return <StoresRenderer settings={section.settings} />;
    case "coupons":
      return <CouponsRenderer settings={section.settings} />;
    case "html_block":
      return <HtmlBlockRenderer settings={section.settings} />;
    case "cta":
      return <CtaRenderer settings={section.settings} />;
    default: {
      // Exhaustiveness check — TS will error here if a new SectionType is
      // added without a renderer. The cast is just to silence the runtime.
      const _exhaustive: never = section;
      void _exhaustive;
      return null;
    }
  }
}

// unused imports silence for tree-shaking safety
void FileText;