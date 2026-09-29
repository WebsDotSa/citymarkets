import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailPage } from "@/components/pages/product/product-detail-page";
import { ProductJsonLd } from "@/components/seo/product-json-ld";
import {
  getProductForSeo,
  productDescription,
} from '@/lib/catalog';
import { buildPageMetadata } from "@/lib/seo/site";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductForSeo(id);
  if (!product || !product.is_active) {
    return buildPageMetadata({
      title: "منتج غير موجود",
      description: "المنتج الذي تبحث عنه غير متوفر حالياً.",
      path: `/products/${id}`,
      noIndex: true,
    });
  }

  const title = `${product.name_ar} — تسوق أونلاين`;
  return buildPageMetadata({
    title,
    description: productDescription(product),
    path: `/products/${product.id}`,
    image: product.image_url,
  });
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  const product = await getProductForSeo(id);
  if (!product || !product.is_active) {
    notFound();
  }

  return (
    <>
      <ProductJsonLd product={product} />
      <ProductDetailPage />
    </>
  );
}
