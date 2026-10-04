"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthState } from "@/contexts/auth-context";
import { useConfirm } from "@/components/ui/toast";
import { PageContainer } from "@/components/ui/page-container";
import { Star, ArrowRight, Trash2, CheckCircle2 } from "lucide-react";

interface ReviewRow {
  id: string;
  product_id: string;
  product_name: string | null;
  product_image: string | null;
  rating: number;
  comment: string | null;
  is_verified_purchase: boolean;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
}

export function ProfileReviews() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthState();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Same auth-bootstrap guard as profile-new.tsx.
    if (authLoading) return;
    if (!user) {
      router.push("/auth/login?redirect=/profile/reviews");
      return;
    }

    let cancelled = false;
    fetch("/api/v1/reviews?mine=1&limit=100")
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res.success) throw new Error(res.error || "fetch failed");
        setReviews(res.reviews || []);
      })
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : "حصل خطأ"),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, router]);

  const removeReview = async (id: string) => {
    const ok = await confirm({
      title: "حذف التقييم",
      message: "هل أنت متأكد من حذف هذا التقييم؟",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/v1/reviews?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setReviews((prev) => prev.filter((r) => r.id !== id));
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || "ما قدرنا نحذف التقييم");
      }
    } catch (e) {
      setError("حصل خطأ بالشبكة");
    }
  };

  if (loading) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <p className="text-gray-500">جاري التحميل...</p>
      </main>
    );
  }

  return (
    <PageContainer width="narrow" padding="normal" className="py-6">
      <Link
        href="/profile"
        className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-4"
      >
        <ArrowRight className="w-4 h-4" />
        حسابي
      </Link>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">مراجعاتي</h1>
          <p className="text-sm text-gray-500 mt-1">
            المنتجات اللي قيمتها — أضف أو احذف تقييمك في أي وقت.
          </p>
        </header>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {reviews.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h2 className="font-semibold text-gray-900 mb-1">ما عندك مراجعات بعد</h2>
            <p className="text-sm text-gray-500 mb-4">
              بعد ما يوصلك الطلب، شاركنا رأيك في المنتج.
            </p>
            <Link
              href="/orders"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium"
            >
              افتح طلباتي
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3"
              >
                <Link
                  href={`/products/${r.product_id}`}
                  className="shrink-0 w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center"
                >
                  {r.product_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.product_image}
                      alt={r.product_name || ""}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Star className="w-6 h-6 text-gray-400" />
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link
                    href={`/products/${r.product_id}`}
                    className="font-medium text-gray-900 truncate block hover:text-primary"
                  >
                    {r.product_name || "منتج"}
                  </Link>

                  <div className="flex items-center gap-1 mt-1" aria-label={`تقييم ${r.rating} من 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={
                          "w-4 h-4 " +
                          (n <= r.rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-gray-300")
                        }
                      />
                    ))}
                  </div>

                  {r.comment && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-3">
                      {r.comment}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleDateString("ar-SA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                    <div className="flex items-center gap-3">
                      {r.is_verified_purchase && (
                        <span className="inline-flex items-center gap-1 text-xs text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          مشترى موثّق
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeReview(r.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="حذف التقييم"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {confirm.dialog}
    </PageContainer>
  );
}
