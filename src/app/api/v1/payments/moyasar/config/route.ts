import { NextResponse } from 'next/server';
import {
  getMoyasarApplePayLabel,
  getMoyasarPublishableKey,
  getMoyasarSiteUrl,
  isMoyasarInlineConfigured,
} from '@/lib/payments/moyasar';

/** إعدادات نموذج ميسر للواجهة (المفتاح العام فقط) */
export async function GET() {
  if (!isMoyasarInlineConfigured()) {
    return NextResponse.json(
      { success: false, error: 'الدفع المدمج غير مفعّل' },
      { status: 503 }
    );
  }

  const publishableKey = getMoyasarPublishableKey();
  if (!publishableKey) {
    return NextResponse.json(
      { success: false, error: 'مفتاح ميسر العام غير مُعدّ' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    publishable_api_key: publishableKey,
    site_url: getMoyasarSiteUrl(),
    apple_pay_label: getMoyasarApplePayLabel(),
    apple_pay_validate_url: 'https://api.moyasar.com/v1/applepay/initiate',
    currency: 'SAR',
    language: 'ar',
  });
}
