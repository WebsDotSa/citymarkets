"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { AdminForm } from "@/components/admin/admin-form";
import { ImageUploader } from "@/components/admin/image-uploader";
import { useToast, useConfirm } from "@/components/ui/toast";
import { safeFetchJson } from "@/lib/safe-fetch";
import { csrfFetch } from "@/lib/csrf-client";
import { VENDOR_TYPE_LABELS_AR, type VendorType } from '@/lib/catalog';
import type { FormField } from "./form-fields/form-field";
import {
  vendorNameColumn,
  vendorTypeColumn,
  vendorContactColumn,
} from "./admin-vendors-columns";
import { VendorPreviewCard } from "./admin-vendors-preview";
import type { Vendor } from "./admin-vendors-types";

const adminCred: RequestInit = { credentials: "include" };

type View = "list" | "new" | "edit";

const VENDOR_TYPE_OPTIONS = (
  Object.entries(VENDOR_TYPE_LABELS_AR) as [VendorType, string][]
).map(([value, label]) => ({ value, label }));

const FIELDS: FormField[] = [
  { key: "name_ar", label: "اسم المتجر بالعربية", type: "text", required: true },
  { key: "name_en", label: "اسم المتجر بالإنجليزية", type: "text" },
  { key: "slug", label: "المعرّف (slug)", type: "text", placeholder: "يُولّد تلقائياً من الاسم" },
  {
    key: "vendor_type",
    label: "نوع المتجر",
    type: "select",
    options: VENDOR_TYPE_OPTIONS,
    required: true,
  },
  { key: "category_slug", label: "slug الفئة", type: "text", placeholder: "مثل: specialty, fashion" },
  { key: "description_ar", label: "الوصف بالعربية", type: "textarea", rows: 3 },
  { key: "description_en", label: "الوصف بالإنجليزية", type: "textarea", rows: 3 },
  { key: "logo_url", label: "رابط الشعار (Logo URL)", type: "text", help: "ارفع الصورة من قسم «رفع الصور» بالأسفل والصق الرابط هنا." },
  { key: "banner_url", label: "رابط صورة الغلاف (Banner URL)", type: "text", help: "ارفع صورة الغلاف من قسم «رفع الصور» بالأسفل والصق الرابط هنا." },
  { key: "primary_color", label: "اللون الرئيسي للهوية", type: "color", defaultValue: "#009345" },
  { key: "contact_phone", label: "رقم الهاتف", type: "text" },
  { key: "contact_whatsapp", label: "رقم واتساب", type: "text" },
  { key: "contact_email", label: "البريد الإلكتروني", type: "text" },
  { key: "address_ar", label: "العنوان", type: "text" },
  { key: "pickup_lat", label: "خط العرض (Latitude)", type: "number" },
  { key: "pickup_lng", label: "خط الطول (Longitude)", type: "number" },
  { key: "sort_order", label: "ترتيب العرض", type: "number", defaultValue: 0 },
  // Vendor owner login credentials. The API upserts a `vendor_staff`
  // row with role='owner' so the merchant can sign in to their dashboard.
  // Phone is OPTIONAL — you can create a store first and add the owner
  // login later. When phone IS provided, password (≥8 chars) is also
  // required to bootstrap the row. Email is OPTIONAL. Empty password on
  // edit = leave unchanged. Owner phone must be a Saudi mobile
  // (5XXXXXXXX).
  { key: "login_phone", label: "رقم جوال المالك (لدخول المتجر) — اختياري", type: "tel", placeholder: "5XXXXXXXX" },
  { key: "login_email", label: "إيميل المالك (اختياري)", type: "email", placeholder: "owner@example.com" },
  { key: "password", label: "كلمة مرور المالك (8 أحرف على الأقل)", type: "password", placeholder: "اتركه فارغاً للإبقاء على الحالية" },
  { key: "is_featured", label: "متجر مميز (يظهر في الصفحة الرئيسية)", type: "checkbox" },
  { key: "is_active", label: "متجر نشط", type: "checkbox" },
];

export function AdminVendors() {
  const [view, setView] = useState<View>("list");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const res = await safeFetchJson<{ success: boolean; data: Vendor[] }>(
      "/api/admin/vendors",
      { ...adminCred, signal }
    );
    if (signal?.aborted) return;
    if (res?.success) setVendors(res.data);
    setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  const handleDelete = async (item: Vendor) => {
    if (
      !(await confirm({
        title: "حذف متجر",
        message: `حذف المتجر "${item.name_ar}"؟ هذا الإجراء لا يمكن التراجع عنه.`,
        danger: true,
      }))
    )
      return;
    const res = await csrfFetch(`/api/admin/vendors?id=${item.id}`, {
      method: "DELETE",
      ...adminCred,
    }).then((r) => r.json());
    if (!res.success) {
      showToast(res.error || "فشل الحذف", "error");
    } else {
      load();
      showToast("تم حذف المتجر", "success");
    }
  };

  const toggleField = async (item: Vendor, key: "is_active" | "is_featured") => {
    const next = !item[key];
    const res = await csrfFetch(`/api/admin/vendors/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
      ...adminCred,
    }).then((r) => r.json());
    if (!res.success) {
      showToast(res.error || "فشل التحديث", "error");
    } else {
      showToast(next ? "تم التفعيل" : "تم الإيقاف", "success");
      load();
    }
  };

  const handleSubmit = async (data: Record<string, unknown>) => {
    setSubmitting(true);
    const payload = {
      name_ar: data.name_ar,
      name_en: data.name_en || null,
      slug: data.slug || null,
      description_ar: data.description_ar || null,
      description_en: data.description_en || null,
      logo_url: data.logo_url || null,
      banner_url: data.banner_url || null,
      vendor_type: data.vendor_type || "food_beverage",
      category_slug: data.category_slug || null,
      primary_color: data.primary_color || "#009345",
      contact_phone: data.contact_phone || null,
      contact_email: data.contact_email || null,
      contact_whatsapp: data.contact_whatsapp || null,
      address_ar: data.address_ar || null,
      pickup_lat: data.pickup_lat ?? null,
      pickup_lng: data.pickup_lng ?? null,
      is_active: data.is_active !== false,
      is_featured: data.is_featured === true,
      sort_order: Number(data.sort_order) || 0,
      // Owner login — only sent when provided so empty values on edit
      // don't overwrite existing credentials.
      //   - login_phone: REQUIRED on create; on edit the field is always
      //     sent (the API rejects deletion of the only owner-phone).
      //   - login_email: OPTIONAL; empty string clears it.
      //   - password: empty string on edit = leave hash untouched.
      login_phone: data.login_phone ? String(data.login_phone).trim() : (editing ? "" : undefined),
      login_email: data.login_email
        ? String(data.login_email).trim()
        : (editing ? "" : undefined),
      password: data.password ? String(data.password) : undefined,
    };
    const url = editing ? `/api/admin/vendors?id=${editing.id}` : "/api/admin/vendors";
    const res = await csrfFetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      ...adminCred,
    }).then((r) => r.json());
    setSubmitting(false);
    if (res.success) {
      setView("list");
      load();
      showToast("تم حفظ المتجر", "success");
    } else showToast(res.error || "فشل الحفظ", "error");
  };

  const columns = [
    { key: "name_ar", label: "المتجر", render: vendorNameColumn },
    { key: "vendor_type", label: "النوع", render: vendorTypeColumn },
    {
      key: "credentials",
      label: "بيانات الدخول",
      render: (r: Vendor) => {
        const hasLogin = r.has_owner && (r.login_email || r.login_phone);
        if (!hasLogin) {
          return (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
              ⚠ بدون حساب دخول
            </span>
          );
        }
        return (
          <div className="flex flex-col gap-0.5">
            {r.login_phone ? (
              <span
                className="text-[12px] text-gray-700 dir-ltr text-right"
                title={`الجوال: ${r.login_phone}`}
                dir="ltr"
              >
                📱 {r.login_phone}
              </span>
            ) : null}
            {r.login_email ? (
              <span
                className="text-[11px] text-gray-500 dir-ltr text-right"
                title={`البريد: ${r.login_email}`}
                dir="ltr"
              >
                ✉ {r.login_email}
              </span>
            ) : null}
            <span className="text-[10px] text-emerald-600 font-medium">✓ حساب مالك جاهز</span>
          </div>
        );
      },
    },
    { key: "contact", label: "التواصل", render: vendorContactColumn },
    {
      key: "status",
      label: "الحالة",
      render: (r: Vendor) => (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => toggleField(r, "is_active")}
            className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
              r.is_active
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
            title="اضغط لتغيير الحالة"
          >
            {r.is_active ? "نشط" : "متوقف"}
          </button>
          <button
            onClick={() => toggleField(r, "is_featured")}
            className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
              r.is_featured
                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "bg-gray-50 text-gray-400 hover:bg-gray-100"
            }`}
            title="اضغط لإظهار/إخفاء في الرئيسية"
          >
            {r.is_featured ? "★ مميز" : "عادي"}
          </button>
        </div>
      ),
    },
  ];

  if (view !== "list") {
    return (
      <VendorFormView
        editing={editing}
        vendorsCount={vendors.length}
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
        <p className="font-medium">💡 إدارة المتاجر</p>
        <p className="mt-1">
          أضف شعار ووصف ولون رئيسي لكل متجر. ستظهر هذه الهوية في صفحة{" "}
          <Link href="/vendors" className="underline" target="_blank">
            المتاجر
          </Link>{" "}
          وعلى بطاقات المنتجات داخل المتجر.
        </p>
      </div>
      <DataTable
        title="المتاجر"
        columns={columns}
        data={vendors}
        loading={loading}
        onAdd={() => {
          setEditing(null);
          setView("new");
        }}
        onEdit={(item) => {
          setEditing(item as Vendor);
          setView("edit");
        }}
        onDelete={handleDelete as (item: any) => Promise<void>}
        onView={(item) => {
          window.open(`/vendors/${(item as Vendor).slug}`, "_blank", "noopener");
        }}
      />
      {confirm.dialog}
    </div>
  );
}

/**
 * New / edit view. Owns the live-image-upload state and forces the
 * form to re-initialise whenever a new image URL is produced.
 */
function VendorFormView({
  editing,
  vendorsCount,
  submitting,
  onSubmit,
  onCancel,
}: {
  editing: Vendor | null;
  vendorsCount: number;
  submitting: boolean;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [logoOverride, setLogoOverride] = useState<string | null>(
    editing?.logo_url ?? null
  );
  const [bannerOverride, setBannerOverride] = useState<string | null>(
    editing?.banner_url ?? null
  );

  const handleImageUploaded = (kind: "logo" | "banner", url: string) => {
    if (kind === "logo") setLogoOverride(url);
    else setBannerOverride(url);
    // AdminForm now merges new initialValues field-by-field (since the
    // soft-merge fix), so uploading an image no longer wipes the user's
    // other typed input. No `formKey` bump needed.
  };

  const initial = {
    ...(editing || {}),
    logo_url: logoOverride ?? editing?.logo_url ?? "",
    banner_url: bannerOverride ?? editing?.banner_url ?? "",
    primary_color: editing?.primary_color || "#009345",
    is_active: editing ? editing.is_active !== false : true,
    is_featured: editing ? editing.is_featured === true : false,
    sort_order: editing?.sort_order ?? vendorsCount,
    vendor_type: editing?.vendor_type || "food_beverage",
    // Pre-fill the owner's login phone (required) and email (optional) so
    // the admin can confirm what's currently configured. Password field
    // intentionally stays empty — empty submit = leave the existing
    // hash untouched.
    login_phone: editing?.login_phone ?? "",
    login_email: editing?.login_email ?? "",
    password: "",
  };

  return (
    <div className="space-y-4">
      <AdminForm
        title={editing ? `تعديل المتجر: ${editing.name_ar}` : "متجر جديد"}
        subtitle="سيظهر المتجر في صفحة المتاجر وصفحة المنتج بهويته البصرية ولونه المميز."
        fields={FIELDS}
        initialValues={initial}
        onSubmit={onSubmit}
        onCancel={onCancel}
        loading={submitting}
        previewTitle="معاينة بطاقة المتجر"
        renderPreview={(data) => <VendorPreviewCard data={data} />}
      />

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        <h3 className="font-bold text-secondary">رفع الصور</h3>
        <p className="text-xs text-gray-500">
          ارفع الشعار أو صورة الغلاف — الرابط يُحقن تلقائياً في حقل النص
          أعلاه، ويجب الضغط على <strong>حفظ</strong> لتسجيله في قاعدة البيانات.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              الشعار (Logo)
            </label>
            <ImageUploader
              value={logoOverride || ""}
              onChange={(url) => handleImageUploaded("logo", url)}
              folder="vendors"
              aspectRatio="aspect-square"
              placeholder="اضغط لرفع الشعار"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              صورة الغلاف (Banner)
            </label>
            <ImageUploader
              value={bannerOverride || ""}
              onChange={(url) => handleImageUploaded("banner", url)}
              folder="vendors"
              aspectRatio="aspect-video"
              placeholder="اضغط لرفع صورة الغلاف"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
