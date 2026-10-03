"use client";

import { Shield, ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export default function ProfileSecurityPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-primary text-sm font-medium mb-6 hover:text-primary-dark transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          العودة للملف الشخصي
        </Link>

        <PageHeader
          icon={<Shield className="w-6 h-6 text-primary" />}
          title="الأمان والخصوصية"
          subtitle="معلومات عن تسجيل الدخول وحماية بياناتك"
          className="mb-6"
        />

        <Card className="p-6">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm leading-relaxed">
              نحمي حسابك عبر تسجيل الدخول برمز تحقق لمرة واحدة (OTP) يُرسل إلى رقم جوالك. لا
              نشارك رمز التحقق مع أي طرف ثالث.
            </p>

            <ul className="list-disc list-inside text-sm text-gray-700 space-y-2">
              <li>لا تُشارك رمز التحقق مع أي شخص يدّعي أنه من أسواق سيتي.</li>
              <li>سجّل الخروج من الأجهزة المشتركة بعد الانتهاء.</li>
              <li>
                راجع{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  سياسة الخصوصية
                </Link>{" "}
                لمعرفة كيفية استخدام بياناتك.
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </main>
  );
}
