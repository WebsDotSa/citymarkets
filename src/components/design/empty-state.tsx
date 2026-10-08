"use client";

import Link from "next/link";
import {
  ShoppingCart,
  Package,
  Heart,
  Search,
  MapPin,
  Bell,
  CreditCard,
  User,
  ArrowLeft,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { Button } from "./button";

interface EmptyStateProps {
  icon?: "cart" | "orders" | "wishlist" | "search" | "address" | "notification" | "payment" | "profile" | "custom";
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  customIcon?: React.ReactNode;
  className?: string;
}

const icons = {
  cart: ShoppingCart,
  orders: Package,
  wishlist: Heart,
  search: Search,
  address: MapPin,
  notification: Bell,
  payment: CreditCard,
  profile: User,
  custom: Inbox,
};

export function EmptyState({
  icon = "custom",
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  customIcon,
  className = "",
}: EmptyStateProps) {
  const IconComponent = icons[icon];

  const renderContent = () => (
    <>
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center mb-6 animate-float">
        {customIcon ? (
          <div className="text-primary">{customIcon}</div>
        ) : (
          <IconComponent className="w-12 h-12 text-primary" />
        )}
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      {description && (
        <p className="text-gray-500 text-center max-w-sm mb-6">{description}</p>
      )}
      {(actionLabel || onAction) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {actionHref ? (
            <Link href={actionHref}>
              <Button variant="primary" rightIcon={<ArrowLeft className="w-5 h-5" />}>
                {actionLabel || "ابدأ التسوق"}
              </Button>
            </Link>
          ) : onAction ? (
            <Button variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}
    >
      {renderContent()}
    </div>
  );
}

// Preset Empty States
export function EmptyCart({ className }: { className?: string }) {
  return (
    <EmptyState
      icon="cart"
      title="سلة التسوق فارغة"
      description="لم تضف أي منتجات بعد! تصفح منتجاتنا وأضف ما يعجبك"
      actionLabel="تصفح المنتجات"
      actionHref="/catalog"
      className={className}
    />
  );
}

export function EmptyOrders({ className }: { className?: string }) {
  return (
    <EmptyState
      icon="orders"
      title="لا توجد طلبات"
      description="لم تقم بأي طلبات بعد. ابدأ التسوق الآن!"
      actionLabel="تسوق الآن"
      actionHref="/catalog"
      className={className}
    />
  );
}

export function EmptyWishlist({ className }: { className?: string }) {
  return (
    <EmptyState
      icon="wishlist"
      title="المفضلة فارغة"
      description="أضف منتجات إلى قائمة أمنياتك للوصول إليها لاحقاً"
      actionLabel="تصفح المنتجات"
      actionHref="/catalog"
      className={className}
    />
  );
}

export function EmptySearch({
  query,
  className,
}: {
  query?: string;
  className?: string;
}) {
  return (
    <EmptyState
      icon="search"
      title="لم يتم العثور على نتائج"
      description={
        query
          ? `لا توجد نتائج لـ "${query}". جرب البحث بكلمات مختلفة.`
          : "جرب البحث بكلمات مختلفة أو تصفح التصنيفات."
      }
      actionLabel="تصفح التصنيفات"
      actionHref="/categories"
      className={className}
    />
  );
}

export function EmptyAddress({ className }: { className?: string }) {
  return (
    <EmptyState
      icon="address"
      title="لا توجد عناوين"
      description="أضف عنوانك الأول للتوصيل"
      actionLabel="إضافة عنوان"
      onAction={() => {}}
      className={className}
    />
  );
}

// Loading State Component
export function LoadingState({
  message = "جاري التحميل...",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 ${className}`}
    >
      <div className="w-16 h-16 border-4 border-primary/20 border-t-[#009345] rounded-full animate-spin mb-4" />
      <p className="text-gray-500">{message}</p>
    </div>
  );
}

// Error State Component
export function ErrorState({
  message = "حدث خطأ",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-4">
        <svg
          className="w-10 h-10 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">{message}</h3>
      {onRetry && (
        <Button
          variant="outline"
          onClick={onRetry}
          leftIcon={<RefreshCw className="w-5 h-5" />}
          className="mt-4"
        >
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}

// Page Coming Soon
export function ComingSoon({ feature, className }: { feature?: string; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center mb-6 animate-float">
        <svg
          className="w-12 h-12 text-amber-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">قريباً!</h3>
      <p className="text-gray-500 max-w-sm">
        {feature
          ? `ميزة "${feature}" ستتوفر قريباً. stay tuned!`
          : "هذه الميزة ستتوفر قريباً. ابقَ على اطلاع!"}
      </p>
    </div>
  );
}
