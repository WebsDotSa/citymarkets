"use client";

import { Building2, Star, MapPin, Phone } from "lucide-react";
import { VENDOR_TYPE_LABELS_AR } from '@/lib/catalog';

const VENDOR_TYPE_LABEL: Record<string, string> = VENDOR_TYPE_LABELS_AR;

/**
 * Live preview card rendered alongside the vendor form so admins
 * can see the brand identity (color, logo, banner, badge) before
 * saving. Receives a plain Record because the field values are
 * raw form state — not yet typed as a Vendor.
 */
export function VendorPreviewCard({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const color = (data.primary_color as string) || "#009345";
  const logo = data.logo_url as string | null;
  const banner = data.banner_url as string | null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="w-full h-32 object-cover" />
      ) : (
        <div
          className="w-full h-32 flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
          }}
        >
          <Building2 className="w-10 h-10 text-white/60" />
        </div>
      )}
      <div className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden border-2 -mt-8 bg-white"
            style={{ borderColor: color }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="w-full h-full object-cover" />
            ) : (
              <Building2 className="w-6 h-6" style={{ color }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-secondary text-base flex items-center gap-1.5">
              {String(data.name_ar || "اسم المتجر")}
              {data.is_featured === true ? (
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              ) : null}
            </div>
            {data.name_en ? (
              <div className="text-xs text-gray-500" dir="ltr">
                {String(data.name_en)}
              </div>
            ) : null}
            <div
              className="inline-block text-[10px] px-1.5 py-0.5 rounded mt-1"
              style={{ backgroundColor: `${color}15`, color }}
            >
              {VENDOR_TYPE_LABEL[String(data.vendor_type || "food_beverage")] ||
                String(data.vendor_type)}
            </div>
          </div>
        </div>
        {data.description_ar ? (
          <p className="text-xs text-gray-600 line-clamp-3">
            {String(data.description_ar)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500 pt-2 border-t border-gray-100">
          {data.contact_phone ? (
            <span className="flex items-center gap-1">
              <Phone className="w-3 h-3" />
              <span dir="ltr">{String(data.contact_phone)}</span>
            </span>
          ) : null}
          {data.address_ar ? (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {String(data.address_ar)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
