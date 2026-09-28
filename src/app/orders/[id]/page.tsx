import { OrderDetailClient } from '@/components/pages/direct-order/order-detail-client';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailClient orderId={id} />;
}