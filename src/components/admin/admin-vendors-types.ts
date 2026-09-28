// Shared Vendor type used by admin-vendors.tsx, the column renderers,
// and the live preview card. Kept in a leaf module so the import graph
// stays a DAG (form.tsx → columns/preview → types).
export type Vendor = {
  id: string;
  slug: string;
  name_ar: string;
  name_en?: string | null;
  description_ar?: string | null;
  description_en?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  vendor_type: string;
  category_slug?: string | null;
  primary_color?: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_whatsapp?: string | null;
  address_ar?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  is_active?: boolean;
  is_featured?: boolean;
  sort_order?: number;
  // Owner login credentials — populated by GET /api/admin/vendors so the
  // edit form can pre-fill phone / email and the data table can show
  // whether a vendor has a usable login set up. Phone is the primary
  // login surface; email is optional.
  login_email?: string | null;
  login_phone?: string | null;
  has_owner?: boolean;
};
