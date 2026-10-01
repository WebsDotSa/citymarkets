"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCartActions } from "@/contexts/cart-context";
import { vendorProductToCartProduct } from '@/lib/catalog';

interface Product {
  id: string;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  images: string[];
  price: number;
  discountPrice?: number;
  inStock: boolean;
  stock?: number;
  sku?: string;
  metadata?: any;
}

interface RelatedProduct {
  id: string;
  name: string;
  image?: string;
  price: number;
  discountPrice?: number;
}

export default function VendorProductPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = use(params);
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const { addItem: addToCartContext } = useCartActions();

  /**
   * Map a vendor product to the canonical `Product` shape that CartV2 /
   * useCart() expect. Without this mapping the item was written to a
   * separate localStorage key (`"cart"`) with a different schema, so
   * /cart never saw it and checkout was silently impossible.
   *
   * The mapping lives in `@/lib/vendor-product-mapper` so the listing
   * page (`/vendors/[slug]`) and this detail page stay in sync and the
   * vendor provenance fields are typed (no more
   * `Record<string, string | undefined>` cast).
   */

  useEffect(() => {
    fetchProduct();
  }, [slug, id]);

  async function fetchProduct() {
    try {
      const res = await fetch(`/api/v1/vendors/${slug}/products/${id}`);
      if (!res.ok) throw new Error("المنتج غير موجود");
      const data = await res.json();
      setProduct(data.product);
      setRelatedProducts(data.product.relatedProducts || []);
    } catch (err) {
      setError("حدث خطأ في تحميل المنتج");
    } finally {
      setLoading(false);
    }
  }

  async function addToCart() {
    if (!product) return;
    setAdding(true);
    try {
      // Route through the shared cart-context. Previously this page wrote
      // to localStorage key `"cart"` with a different schema; CartV2
      // reads key `"city_market_cart"` with `{product, quantity}` shape.
      // The two never reconciled → vendor items were silently invisible
      // at /cart and could not be checked out.
      const mapped = vendorProductToCartProduct(product, {
        vendorId: product.vendorId,
        vendorSlug: product.vendorSlug,
        vendorName: product.vendorName,
      });
      addToCartContext(mapped, quantity);
      window.dispatchEvent(new Event("cartUpdated"));
      router.push("/cart");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="h-80 bg-gray-200 animate-pulse" />
        <div className="p-4">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="h-4 w-full bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-6">
          <h1 className="text-xl font-bold text-gray-900 mb-2">المنتج غير موجود</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <Link href="/" className="text-primary hover:underline">
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Image gallery */}
      <div className="relative">
        <div className="relative aspect-square bg-gray-100">
          {product.images.length > 0 ? (
            <Image
              src={product.images[activeImage]}
              alt={product.name}
              fill
              sizes="100vw"
              className="object-cover"
              priority
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">
              📦
            </div>
          )}
        </div>

        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="absolute top-4 end-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Vendor badge */}
        <Link
          href={`/vendors/${product.vendorSlug}`}
          className="absolute top-4 start-4 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur shadow text-sm font-medium"
        >
          {product.vendorName}
        </Link>

        {/* Image thumbnails */}
        {product.images.length > 1 && (
          <div className="absolute bottom-4 start-1/2 -translate-x-1/2 flex gap-2">
            {product.images.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveImage(idx)}
                className={`w-3 h-3 rounded-full transition-colors ${
                  idx === activeImage ? "bg-primary" : "bg-white/70"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Product info */}
      <div className="p-4">
        <h1 className="text-xl font-bold text-gray-900">{product.name}</h1>
        {product.nameEn && (
          <p className="text-sm text-gray-500 mb-2">{product.nameEn}</p>
        )}

        <div className="mt-3 flex items-center gap-3">
          {product.discountPrice ? (
            <>
              <span className="text-2xl font-bold text-primary">
                {product.discountPrice.toFixed(2)} ر.س
              </span>
              <span className="text-lg text-gray-400 line-through">
                {product.price.toFixed(2)}
              </span>
              <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full font-medium">
                خصم {Math.round((1 - product.discountPrice / product.price) * 100)}%
              </span>
            </>
          ) : (
            <span className="text-2xl font-bold text-primary">
              {product.price.toFixed(2)} ر.س
            </span>
          )}
        </div>

        {/* Stock status */}
        <div className="mt-2 flex items-center gap-2">
          {product.inStock ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-green-600">متوفر</span>
              {product.stock != null && product.stock <= 5 && (
                <span className="text-xs text-orange-500">
                  (باقي فقط {product.stock})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm text-red-600">نفذت الكمية</span>
            </>
          )}
        </div>

        {/* Description */}
        {product.description && (
          <div className="mt-4">
            <h2 className="font-semibold text-gray-900 mb-2">الوصف</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {product.description}
            </p>
          </div>
        )}

        {/* SKU */}
        {product.sku && (
          <div className="mt-3 text-xs text-gray-400">SKU: {product.sku}</div>
        )}
      </div>

      {/* Related products */}
      {relatedProducts.length > 0 && (
        <div className="mt-6 px-4">
          <h2 className="font-semibold text-gray-900 mb-3">منتجات مشابهة</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {relatedProducts.map((p) => (
              <Link
                key={p.id}
                href={`/vendors/${slug}/products/${p.id}`}
                className="flex-shrink-0 w-32 bg-white rounded-xl overflow-hidden shadow-sm"
              >
                <div className="relative aspect-square bg-gray-100">
                  {p.image ? (
                    <Image src={p.image} alt={p.name} fill sizes="128px" className="object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">📦</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium line-clamp-1">{p.name}</p>
                  <p className="text-xs font-bold text-primary">
                    {p.discountPrice ? p.discountPrice : p.price} ر.س
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Add to cart */}
      {product.inStock && (
        <div className="fixed bottom-0 start-0 end-0 p-4 bg-white border-t border-gray-100">
          <div className="flex items-center gap-3">
            {/* Quantity selector */}
            <div className="flex items-center border border-gray-200 rounded-xl">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 flex items-center justify-center text-lg"
              >
                -
              </button>
              <span className="w-10 text-center font-semibold">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 flex items-center justify-center text-lg"
              >
                +
              </button>
            </div>

            {/* Add button */}
            <button
              onClick={addToCart}
              disabled={adding}
              className="flex-1 py-3 rounded-xl bg-primary text-white font-bold flex items-center justify-center gap-2"
            >
              {adding ? (
                <span>جاري الإضافة...</span>
              ) : (
                <>
                  <span>🛒</span>
                  <span>أضف للسلة</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
