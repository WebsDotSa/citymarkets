"use client";

import { Shield, Lock, Truck, CreditCard, RotateCcw } from "lucide-react";

interface TrustBadge {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function TrustBadges({ variant = "default", className = "" }: { variant?: "default" | "compact" | "checkout"; className?: string }) {
  const badges: TrustBadge[] = [
    {
      icon: <Lock className="w-5 h-5" />,
      title: "دفع آمن 100%",
      description: "تشفير 256-bit",
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "حماية بياناتك",
      description: "لن نشارك بياناتك",
    },
    {
      icon: <RotateCcw className="w-5 h-5" />,
      title: "سياسة إرجاع مرنة",
      description: "خلال 24 ساعة",
    },
    {
      icon: <Truck className="w-5 h-5" />,
      title: "توصيل سريع",
      description: "خلال 30 دقيقة",
    },
  ];

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-4 text-xs text-gray-500 ${className}`}>
        <div className="flex items-center gap-1">
          <Lock className="w-3.5 h-3.5 text-green-600" />
          <span>دفع آمن</span>
        </div>
        <div className="flex items-center gap-1">
          <Shield className="w-3.5 h-3.5 text-green-600" />
          <span>مشفر</span>
        </div>
      </div>
    );
  }

  if (variant === "checkout") {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-green-600" />
            <span>تشفير 256-bit</span>
          </div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-green-600" />
            <span>Visa / Mastercard</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <Shield className="w-3.5 h-3.5" />
          <span>مدعوم بواسطة Moyasar — شريك دفع معتمد في السعودية</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {badges.map((badge, index) => (
        <div
          key={index}
          className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
        >
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-primary shadow-sm">
            {badge.icon}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900">{badge.title}</p>
            <p className="text-[10px] text-gray-500">{badge.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SecurePaymentBadge() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
      <Lock className="w-4 h-4 text-green-600" />
      <span className="text-xs text-green-700 font-medium">اتصال مشفر وآمن</span>
    </div>
  );
}
