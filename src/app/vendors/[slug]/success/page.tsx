"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function VendorOrderSuccessPage() {
  const searchParams = useSearchParams();
  const params = useParams<{ slug: string }>();
  // Slug comes from the dynamic route — the page is mounted at
  // /vendors/<slug>/success, so useParams is the source of truth.
  // Previously this was hardcoded to "qahwa-amaze", which silently
  // fetched the wrong vendor's order when the success URL was reached
  // from any other vendor's checkout.
  const slug = params?.slug ?? "";
  const orderNumber = searchParams.get("order");
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (orderNumber && slug) {
      // Fetch order details for THIS vendor's checkout.
      fetch(`/api/v1/vendors/${encodeURIComponent(slug)}/orders?id=${orderNumber}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.orders?.[0]) {
            setOrder(data.orders[0]);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [orderNumber, slug]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-12 h-12 text-green-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          تم استلام طلبك بنجاح! 🎉
        </h1>

        <p className="text-gray-600 mb-6">
          شكراً لك! تم استلام طلبك وسيتم التجهيز والتوصيل في أقرب وقت
        </p>

        {orderNumber && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">رقم الطلب</p>
            <p className="text-xl font-bold text-primary">{orderNumber}</p>
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
            <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto" />
          </div>
        ) : order ? (
          <div className="bg-gray-50 rounded-xl p-4 mb-6 text-right">
            <h3 className="font-semibold mb-3">تفاصيل الطلب:</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">المجموع:</span>
                <span className="font-semibold">{order.total} ر.س</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">الحالة:</span>
                <span className="text-green-600 font-medium">مؤكد ✓</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary-dark transition-colors"
          >
            العودة للرئيسية
          </Link>

          <Link
            href={slug ? `/vendors/${encodeURIComponent(slug)}` : "/vendors"}
            className="block w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
          >
            متابعة التسوق
          </Link>
        </div>
      </div>
    </div>
  );
}
