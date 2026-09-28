import { DirectOrderChatPage } from '@/components/pages/direct-order/direct-order-chat-page';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DirectOrderChatPage orderId={id} />;
}