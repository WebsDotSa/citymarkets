"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, Send, User } from "lucide-react";

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  user_name: string | null;
  is_verified_purchase: boolean;
  created_at: string;
}

interface ProductReviewsProps {
  productId: string;
  /** Whether the current user is signed in. When false, the form is replaced by a sign-in CTA. */
  signedIn: boolean;
  /** Pre-filled user name to greet them; "ضيف" if signed-out. */
  userLabel?: string;
}

export function ProductReviews({ productId, signedIn, userLabel }: ProductReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const loadReviews = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/reviews?productId=${encodeURIComponent(productId)}&limit=20`);
      const data = await res.json();
      if (res.ok && data.success) {
        setReviews(data.reviews || []);
        setAvgRating(data.avgRating);
        setTotal(data.totalReviews || 0);
      }
    } catch {
      /* keep silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, [productId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signedIn) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, rating, comment: comment.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess("شكراً على تقييمك");
        setComment("");
        loadReviews();
      } else {
        setError(data.error || "حدث خطأ");
      }
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-8 px-4" aria-label="تقييمات المنتج">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-900">التقييمات ({total})</h2>
        {avgRating != null && (
          <div className="flex items-center gap-1.5 text-sm">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="font-bold text-gray-900">{avgRating.toFixed(1)}</span>
            <span className="text-gray-500">من 5</span>
          </div>
        )}
      </div>

      {/* Add review form */}
      {signedIn ? (
        <form
          onSubmit={submit}
          className="bg-gray-50 rounded-2xl p-4 mb-5 space-y-3"
          aria-label="إضافة تقييم"
        >
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <User className="w-4 h-4" aria-hidden="true" />
            <span>{userLabel || "حسابك"}</span>
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="اختر تقييماً">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} من 5`}
                onClick={() => setRating(n)}
                className="p-1"
              >
                <Star
                  className={`w-7 h-7 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="اكتب تعليقك (اختياري)..."
            maxLength={500}
            className="w-full text-sm border border-gray-200 rounded-xl p-3 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            {submitting ? "جاري الإرسال..." : "إرسال التقييم"}
          </button>
        </form>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-4 mb-5 text-center text-sm text-gray-600">
          <Link href="/auth/login" className="text-primary font-medium hover:underline">
            سجّل دخولك
          </Link>{" "}
          لإضافة تقييمك
        </div>
      )}

      {/* Reviews list */}
      {loading ? (
        <p className="text-sm text-gray-500 text-center py-6">جاري التحميل...</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">
          ما فيه تقييمات بعد — كن أول من يقيّم
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900">
                    {r.user_name || "مستخدم"}
                  </span>
                  {r.is_verified_purchase && (
                    <span className="text-tiny bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                      مشتري موثوق
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5" aria-label={`تقييم ${r.rating} من 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`w-3.5 h-3.5 ${
                        n <= r.rating ? "fill-amber-400 text-amber-400" : "text-gray-300"
                      }`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
              {r.comment && (
                <p className="text-sm text-gray-700 leading-relaxed mt-1">{r.comment}</p>
              )}
              <p className="text-tiny text-gray-400 mt-2">
                {new Date(r.created_at).toLocaleDateString("ar-SA")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
