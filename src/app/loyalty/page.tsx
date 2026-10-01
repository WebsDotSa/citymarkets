import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'برنامج الولاء - أسواق سيتي المركزية',
  description: 'انضم لبرنامج الولاء في أسواق سيتي واكسب نقاط مع كل عملية شراء. استبدل نقاطك بخصومات على طلباتك القادمة.',
  openGraph: {
    title: 'برنامج الولاء - أسواق سيتي',
    description: 'اكسب نقاط مع كل عملية شراء واستبدلها بخصومات',
  },
};

export default function LoyaltyLandingPage() {
  return (
    <main className="min-h-screen bg-gray-50" id="main-content">
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-[#009345] to-[#007A38] text-white py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 end-20 w-96 h-96 rounded-full bg-white/20" />
          <div className="absolute bottom-10 start-10 w-64 h-64 rounded-full bg-white/10" />
        </div>
        <div className="max-w-5xl mx-auto px-4 relative z-10 text-center">
          <div className="text-6xl mb-6">🎁</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">برنامج الولاء</h1>
          <p className="text-xl text-white/90 max-w-2xl mx-auto mb-8">
            مع كل طلب تكسب نقاط تقدر تستبدلها بخصومات على طلباتك القادمة
          </p>
          <Link
            href="/profile/loyalty"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-primary font-bold rounded-xl hover:bg-gray-100 transition-colors"
          >
            شاهد نقاطك
          </Link>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">كيف يعمل؟</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                icon: '🛒',
                title: 'تسوق',
                desc: 'كل 10 ريالات من طلبك = 1 نقطة',
              },
              {
                step: '2',
                icon: '💰',
                title: 'اكسب نقاط',
                desc: 'النقاط تضاف تلقائياً لحسابك بعد كل طلب',
              },
              {
                step: '3',
                icon: '🎁',
                title: 'استبدل',
                desc: 'كل 100 نقطة = 5 ريالات خصم',
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="relative inline-block mb-4">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
                    <span className="text-4xl">{item.icon}</span>
                  </div>
                  <span className="absolute -top-2 -end-2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">مميزات البرنامج</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { icon: '⚡', title: 'توصيل مجاني', desc: 'اطلب واستبدل نقاطك بتوصيل مجاني لحد باب بيتك' },
              { icon: '🎉', title: 'عروض حصرية', desc: 'احصل على خصومات حصرية غير متاحة لغير الأعضاء' },
              { icon: '🎰', title: 'عجلة الحظ', desc: 'فرصتك تكسب نقاط اضافية مع كل طلب' },
              { icon: '👶', title: 'نقاط اضافية', desc: 'اطلب منتجات العناية بالطفل واحصل على نقاط مضاعفة' },
              { icon: '🎂', title: 'هدية عيد ميلاد', desc: 'احتفل بعيد ميلادك مع 500 نقطة هدية' },
              { icon: '📱', title: 'تنبيهات العروض', desc: 'كن اول من يعرف عن العروض والخصومات الجديدة' },
            ].map((benefit) => (
              <div key={benefit.title} className="flex gap-4 p-6 bg-gray-50 rounded-xl">
                <span className="text-3xl">{benefit.icon}</span>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">{benefit.title}</h3>
                  <p className="text-gray-600 text-sm">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Points Value */}
      <section className="py-16 bg-primary text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">قيمة النقاط</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { points: 100, sar: '5' },
              { points: 500, sar: '25' },
              { points: 1000, sar: '50' },
              { points: 2000, sar: '100' },
            ].map((item) => (
              <div key={item.points} className="bg-white/10 rounded-xl p-6">
                <div className="text-4xl font-bold mb-1">{item.points}</div>
                <div className="text-white/70">نقطة</div>
                <div className="text-xl font-bold mt-2">= {item.sar} ر.س</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">ابدأ اليوم!</h2>
          <p className="text-gray-600 mb-8">
            التسجيل مجاني! اطلب الان وابدأ بجمع النقاط
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/auth/register"
              className="px-8 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary-dark transition-colors"
            >
              إنشاء حساب جديد
            </Link>
            <Link
              href="/catalog"
              className="px-8 py-4 bg-gray-100 text-gray-900 font-bold rounded-xl hover:bg-gray-200 transition-colors"
            >
              تصفح المنتجات
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">أسئلة شائعة</h2>
          <div className="space-y-4">
            {[
              {
                q: 'كيف أكسب نقاط؟',
                a: 'مع كل 10 ريالات من طلبك تكسب نقطة واحدة. النقاط تضاف تلقائياً بعد اكتمال الطلب.',
              },
              {
                q: 'متى تنتهي صلاحية النقاط؟',
                a: 'النقاط صالحة لمدة 12 شهر من تاريخ اكتسابها.',
              },
              {
                q: 'كيف أستبدل نقاطي؟',
                a: 'عند الدفع، اختار "استخدم نقاطي" وأدخل عدد النقاط التي تريد استبدالها.',
              },
              {
                q: 'هل يمكنني استخدام النقاط مع عروض أخرى؟',
                a: 'نعم! يمكنك استخدام النقاط مع أي عرض أو كوبون آخر.',
              },
            ].map((faq, i) => (
              <details key={i} className="bg-gray-50 rounded-xl group">
                <summary className="p-4 cursor-pointer font-semibold text-gray-900 list-none flex justify-between items-center">
                  {faq.q}
                  <span className="text-primary group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="px-4 pb-4 text-gray-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
