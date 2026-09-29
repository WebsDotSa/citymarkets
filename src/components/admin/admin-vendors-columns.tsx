"use client";

import { Building2, Star, MapPin, Phone, Mail } from "lucide-react";
import { VENDOR_TYPE_LABELS_AR } from '@/lib/catalog';
import type { Vendor } from "./admin-vendors-types";

const VENDOR_TYPE_LABEL: Record<string, string> = VENDOR_TYPE_LABELS_AR;

export function vendorLogo(r: Vendor) {
  const color = r.primary_color || "#009345";
  return (
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 border"
      style={{ backgroundColor: `${color}15`, borderColor: `${color}33` }}
    >
      {r.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.logo_url}
          alt={r.name_ar}
          className="w-full h-full object-cover"
        />
      ) : (
        <Building2 className="w-5 h-5" style={{ color }} />
      )}
    </div>
  );
}

export function vendorNameColumn(r: Vendor) {
  return (
    <div className="flex items-center gap-3">
      {vendorLogo(r)}
      <div className="min-w-0">
        <div className="font-semibold text-secondary truncate flex items-center gap-1.5">
          {r.name_ar}
          {r.is_featured && (
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          )}
        </div>
        {r.name_en && (
          <div className="text-[11px] text-gray-500 truncate" dir="ltr">
            {r.name_en}
          </div>
        )}
      </div>
    </div>
  );
}

export function vendorTypeColumn(r: Vendor) {
  return (
    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md">
      {VENDOR_TYPE_LABEL[r.vendor_type] || r.vendor_type}
    </span>
  );
}

export function vendorContactColumn(r: Vendor) {
  return (
    <div className="text-xs text-gray-600 space-y-0.5">
      {r.contact_phone ? (
        <div className="flex items-center gap-1">
          <Phone className="w-3 h-3" />
          <span dir="ltr">{r.contact_phone}</span>
        </div>
      ) : null}
      {r.contact_email ? (
        <div className="flex items-center gap-1">
          <Mail className="w-3 h-3" />
          <span className="truncate max-w-[140px]" dir="ltr">
            {r.contact_email}
          </span>
        </div>
      ) : null}
    </div>
  );
}
