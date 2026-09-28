import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "سياسة الخصوصية",
  description: "كيف نتعامل مع بياناتك في أسواق سيتي",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12" dir="rtl">
      <h1 className="text-2xl font-bold text-secondary mb-4">سياسة الخصوصية</h1>
      <p className="text-gray-600 text-sm leading-relaxed mb-8">
        نلتزم بحماية بياناتك الشخصية. تُستخدم المعلومات التي تقدمها (مثل الاسم والهاتف والعنوان)
        لتنفيذ الطلبات والتواصل معك بخصوص الخدمة.
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-secondary mb-3">١. البيانات التي نجمعها</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-2">
          <li>بيانات الحساب: الاسم ورقم الجوال والبريد الإلكتروني عند التسجيل.</li>
          <li>بيانات الطلبات والتوصيل: العناوين والمنتجات المطلوبة ومعلومات الدفع.</li>
          <li>بيانات الاستخدام: الصفحات والميزات التي تستخدمها داخل التطبيق لتحسين الخدمة.</li>
          <li>بيانات الموقع الجغرافي: عند تفعيل إذن الموقع لعرض المنتجات القريبة وحساب التوصيل.</li>
          <li>إشعارات الجهاز: عند تفعيل الإشعارات لتحديثات الطلبات والعروض.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-secondary mb-3">٢. سبب جمع البيانات</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-2">
          <li>تنفيذ الطلبات ومعالجة الدفع والتوصيل.</li>
          <li>التواصل معك بخصوص الطلبات والحساب والخدمة.</li>
          <li>تحسين تجربة المستخدم وتطوير المنتجات والخدمات.</li>
          <li>الالتزام بالمتطلبات النظامية والمحاسبية والضريبية.</li>
          <li>منع الاحتيال وحماية الحسابات والمعاملات.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-secondary mb-3">٣. مدة الاحتفاظ بالبيانات</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          نحتفظ ببياناتك طالما كان حسابك نشطًا، وبما يتوافق مع المتطلبات النظامية. تُحذف بيانات
          الطلبات والمعاملات بعد المدة اللازمة للامتثال الضريبي والمحاسبي، وتُحذف بيانات الاستخدام
          خلال مدة لا تتجاوز ٢٤ شهرًا.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-secondary mb-3">٤. حذف البيانات</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          يمكنك طلب حذف حسابك وبياناتك في أي وقت من خلال خيار «حذف الحساب» داخل التطبيق، أو
          بالتواصل معنا عبر قنوات الدعم المعتمدة. سنقوم بإزالة بياناتك الشخصية خلال ٣٠ يومًا من
          تاريخ الطلب، مع الاحتفاظ بما يلزم لمتطلبات الامتثال النظامي فقط.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-secondary mb-3">٥. الجهات التي نشارك معها البيانات</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-2">
          <li>بوابات الدفع (مدى، فيزا، ماستركارد، أبل باي، تمارا) لمعالجة المدفوعات.</li>
          <li>شركات التوصيل والخدمات اللوجستية لتنفيذ الطلب.</li>
          <li>مزودو خدمات تقنية (استضافة، بريد إلكتروني، رسائل SMS) باتفاقيات حماية مشددة.</li>
          <li>الجهات الحكومية عند وجود طلب نظامي ملزم.</li>
        </ul>
        <p className="text-sm text-gray-700 leading-relaxed mt-3">
          لا نبيع بياناتك لأي طرف لأغراض تسويقية.
        </p>
      </section>

      <section className="mb-8 border-r-4 border-primary pr-4">
        <h2 className="text-lg font-semibold text-secondary mb-3">٦. ميزة «شيف سيتي» وخدمة OpenAI</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          تستخدم ميزة «شيف سيتي» خدمة OpenAI لمعالجة الأسئلة والنصوص التي يقدمها المستخدم وتوليد
          اقتراحات للوجبات والمنتجات. لا تُرسل البيانات إلى OpenAI إلا بعد موافقة المستخدم الصريحة.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          قد تتضمن البيانات المرسلة نص الرسالة أو النص المحول من الصوت ومعلومات المنتجات اللازمة
          للإجابة، ولا تشمل الاسم أو رقم الهاتف أو عنوان التوصيل أو بيانات الدفع.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          يمكن للمستخدم سحب موافقته من إعدادات الخصوصية داخل التطبيق.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-secondary mb-3">٧. التواصل</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          لأي استفسار يتعلق بالخصوصية أو لممارسة حقوقك، تواصل معنا عبر صفحة «اتصل بنا» داخل
          التطبيق أو من خلال قنوات الدعم المعتمدة.
        </p>
      </section>

      <Link href="/" className="text-primary text-sm font-medium hover:underline">
        ← العودة للرئيسية
      </Link>
    </div>
  );
}
