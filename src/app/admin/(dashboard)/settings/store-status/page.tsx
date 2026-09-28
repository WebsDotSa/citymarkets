import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";
import { AdminStoreStatusSettings } from "@/components/admin/admin-store-status-settings";

// Admin-only — never indexed.
export const metadata: Metadata = buildPageMetadata({
  title: "حالة الموقع — لوحة التحكم",
  path: "/admin/settings/store-status",
  noIndex: true,
});

export default function AdminStoreStatusPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800">حالة الموقع</h1>
      <p className="text-sm text-gray-600">
        من هنا يمكنك إغلاق الموقع لمنع استقبال الطلبات وإظهار إشعار ثابت للزوار
        في أعلى الموقع يفيد بأن الشراء غير متاح حالياً.
      </p>
      <AdminStoreStatusSettings />
    </div>
  );
}
