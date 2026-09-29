import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { query } from "@/lib/db";
import { buildPageMetadata } from "@/lib/seo/site";
import { SafeImage } from "@/components/ui/safe-image";
import { vendorTypeLabel, vendorTypeIcon } from '@/lib/catalog';

export const metadata: Metadata = buildPageMetadata({
  title: "المتاجر",
  description: "تصفح جميع المتاجر المتاحة في أسواق سيتي — قهوة، ورود، بقالة، هدايا والمزيد",
  path: "/vendors",
});

interface Vendor {
  id: string;
  slug: string;
  name_ar: string;
  name_en?: string;
  description_ar?: string;
  description_en?: string;
  logo_url?: string;
  banner_url?: string;
  vendor_type: string;
  primary_color?: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
}

interface VendorWithStats extends Vendor {
  product_count: number;
}

export const dynamic = "force-dynamic";

async function getVendors(): Promise<VendorWithStats[]> {
  const result = await query<VendorWithStats>(
    `SELECT v.id, v.slug, v.name_ar, v.name_en,
            v.description_ar, v.description_en,
            v.logo_url, v.banner_url, v.vendor_type, v.primary_color,
            v.is_active, v.is_featured, v.sort_order, v.created_at,
            COALESCE(pc.cnt, 0)::int AS product_count
       FROM vendors v
       LEFT JOIN (
         SELECT vendor_id, COUNT(*)::int AS cnt
           FROM vendor_products
          WHERE is_active = TRUE
          GROUP BY vendor_id
       ) pc ON pc.vendor_id = v.id
      WHERE v.is_active = TRUE
      ORDER BY v.is_featured DESC, v.sort_order ASC, v.created_at ASC`
  );

  return result.rows;
}

function FeaturedCarousel({ vendors }: { vendors: VendorWithStats[] }) {
  if (vendors.length === 0) return null;
  const featured = vendors.filter((v) => v.is_featured);
  if (featured.length === 0) return null;

  return (
    <section aria-label="المتاجر المميزة" className="mb-8">
      <div className="flex items-end justify-between gap-3 mb-4 px-1">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            المتاجر المميزة
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
            أفضل المتاجر المختارة لك
          </p>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-none py-1 px-0.5 scroll-smooth"
           style={{ scrollSnapType: "x mandatory" }}>
        {featured.map((v) => (
          <Link
            key={v.id}
            href={`/vendors/${v.slug}`}
            className="shrink-0 w-[260px] sm:w-[320px] group relative flex flex-col rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
            style={{ scrollSnapAlign: "center" }}
          >
            <div className="relative h-28 overflow-hidden">
              <SafeImage
                src={v.banner_url}
                alt={v.name_ar}
                fill
                sizes="320px"
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute top-2 right-2 bg-white/95 backdrop-blur px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-600 shadow-sm">
                ⭐ مميز
              </div>
            </div>
            <div className="p-3 flex items-center gap-3">
              <div className="relative w-12 h-12 rounded-xl bg-white border border-slate-100 shadow-sm overflow-hidden shrink-0">
                <SafeImage
                  src={v.logo_url}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm text-slate-900 truncate">{v.name_ar}</h3>
                <p className="text-[11px] text-slate-500 truncate">
                  {vendorTypeIcon(v.vendor_type)} {vendorTypeLabel(v.vendor_type)} · {v.product_count} منتج
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function VendorCard({ vendor }: { vendor: VendorWithStats }) {
  return (
    <Link
      href={`/vendors/${vendor.slug}`}
      className="group bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden border border-slate-100 hover:-translate-y-0.5"
    >
      <div
        className="relative h-32 overflow-hidden"
        style={{
          background: vendor.banner_url
            ? undefined
            : `linear-gradient(135deg, ${vendor.primary_color ?? "#009345"} 0%, ${vendor.primary_color ?? "#009345"}cc 100%)`,
        }}
      >
        {vendor.banner_url && (
          <SafeImage
            src={vendor.banner_url}
            alt={vendor.name_ar}
            fill
            sizes="(max-width: 640px) 50vw, 320px"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/30 to-transparent" />
        <div className="absolute top-2 left-2 flex gap-1">
          {vendor.is_featured && (
            <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
              ⭐
            </span>
          )}
        </div>
      </div>

      <div className="pt-0 px-4 pb-4 relative">
        <div className="absolute -top-7 right-4">
          <div className="w-14 h-14 rounded-2xl bg-white border-4 border-white shadow-md flex items-center justify-center overflow-hidden"
               style={{ borderColor: vendor.primary_color ?? "#009345" }}>
            <SafeImage
              src={vendor.logo_url}
              alt=""
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>
        </div>

        <div className="pt-9">
          <h3 className="font-bold text-base text-slate-900 group-hover:text-primary transition-colors truncate">
            {vendor.name_ar}
          </h3>
          {vendor.name_en && (
            <p className="text-xs text-slate-500 mb-1.5 truncate">{vendor.name_en}</p>
          )}
          {vendor.description_ar && (
            <p className="text-[13px] text-slate-600 line-clamp-2 min-h-[2.4em]">
              {vendor.description_ar}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full"
              style={{
                background: `${vendor.primary_color ?? "#009345"}1a`,
                color: vendor.primary_color ?? "#009345",
              }}
            >
              <span>{vendorTypeIcon(vendor.vendor_type)}</span>
              <span>{vendorTypeLabel(vendor.vendor_type)}</span>
            </span>
            <span className="text-[11px] font-bold text-slate-500 tabular-nums" dir="ltr">
              {vendor.product_count} منتج
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>مفتوح الآن</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function VendorsPage() {
  const vendors = await getVendors();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-4 sm:px-6 max-w-6xl mx-auto pt-4 pb-12">
        <FeaturedCarousel vendors={vendors} />

        <section aria-labelledby="all-vendors">
          <header className="flex items-end justify-between gap-3 mb-4 px-1 flex-wrap">
            <div>
              <h1 id="all-vendors" className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                جميع المتاجر
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                {vendors.length} متجر · تصفح حسب النوع
              </p>
            </div>
          </header>

          {vendors.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                🏪
              </div>
              <h2 className="text-xl font-bold text-slate-700 mb-2">
                لا توجد متاجر حالياً
              </h2>
              <p className="text-slate-500 text-sm">
                سيتم إضافة المتاجر قريباً
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {vendors.map((vendor) => (
                <VendorCard key={vendor.id} vendor={vendor} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
