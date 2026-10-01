import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'من نحن - أسواق سيتي المركزية',
  description: 'تعرف على قصة أسواق سيتي المركزية - سوبرماركت إلكتروني سعودي يقدم تجربة تسوق فريدة مع التوصيل السريع خلال ساعة.',
  openGraph: {
    title: 'من نحن - أسواق سيتي المركزية',
    description: 'سوبرماركت إلكتروني سعودي - توصيل خلال ساعة',
    type: 'website',
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-gray-50" id="main-content">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-[#009345] to-[#007A38] text-white py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 end-10 w-64 h-64 rounded-full bg-white/20" />
          <div className="absolute bottom-10 start-10 w-48 h-48 rounded-full bg-white/10" />
        </div>
        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
            من نحن
          </h1>
          <p className="text-xl text-center text-white/90 max-w-2xl mx-auto">
            نحن أسواق سيتي المركزية - وجهتك الأولى للتسوق الذكي في المملكة العربية السعودية
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">قصتنا</h2>
              <div className="space-y-4 text-gray-600 leading-relaxed">
                <p>
                  بدأت رحلتنا في عام 2020 من مدينة الرياض، بهدف واحد بسيط: 
                  أن نجعل التسوق اليوميللأسرة السعودية أسهل وأسرع من أي وقت مضى.
                </p>
                <p>
                  أدركنا أن احتياجات السوق السعودي فريدة، وأن العميل السعودي يستحق 
                  تجربة تسوق تلبي توقعاته العالية. لذلك، بنينا منصتنا لنقدم:
                </p>
                <ul className="list-disc list-inside space-y-2">
                  <li>توصيل خلال ساعة واحدة</li>
                  <li>منتجات طازجة يومياً من مصادر موثوقة</li>
                  <li>أسعار تنافسية بدون رسوم خفية</li>
                  <li>خدمة عملاء على مدار الساعة</li>
                </ul>
              </div>
            </div>
            <div className="relative h-[400px] rounded-2xl overflow-hidden shadow-2xl">
              <div className="absolute inset-0 bg-gradient-to-br from-[#009345] to-[#007A38] flex items-center justify-center">
                <div className="text-center text-white p-8">
                  <div className="text-6xl mb-4">🏪</div>
                  <p className="text-2xl font-bold">منذ 2020</p>
                  <p className="text-white/80">نخدم أكثر من 50,000 عميل</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">قيمنا</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: '🎯', title: 'الجودة', desc: 'نختار أفضل المنتجات من مصادر موثوقة' },
              { icon: '⚡', title: 'السرعة', desc: 'توصيل خلال ساعة في الرياض' },
              { icon: '💚', title: 'الثقة', desc: 'أسعار شفافة بدون رسوم خفية' },
              { icon: '❤️', title: 'الاهتمام', desc: 'خدمة عملاء تهتم بك وبعائلتك' },
            ].map((value, i) => (
              <div key={i} className="text-center p-6 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="text-5xl mb-4">{value.icon}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{value.title}</h3>
                <p className="text-gray-600">{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { number: '50,000+', label: 'عميل سعيد' },
              { number: '10,000+', label: 'منتج' },
              { number: '1 ساعة', label: 'متوسط التوصيل' },
              { number: '4.8', label: 'تقييم التطبيق' },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-4xl md:text-5xl font-bold mb-2">{stat.number}</div>
                <div className="text-white/80">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">فريقنا</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { name: 'فريق التطوير', role: 'تقنية المعلومات', icon: '👨‍💻' },
              { name: 'فريق المشتريات', role: 'جودة المنتجات', icon: '🛒' },
              { name: 'فريق التوصيل', role: 'خدمة التوصيل', icon: '🚚' },
              { name: 'فريق الدعم', role: 'خدمة العملاء', icon: '💬' },
              { name: 'فريق التسويق', role: 'العروض والخصومات', icon: '🎉' },
              { name: 'فريق الجودة', role: 'ضمان الجودة', icon: '✅' },
            ].map((member, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl shadow-lg text-center">
                <div className="text-5xl mb-4">{member.icon}</div>
                <h3 className="text-lg font-bold text-gray-900">{member.name}</h3>
                <p className="text-gray-500">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="py-16 bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">تواصل معنا</h2>
          <p className="text-gray-400 mb-8">
            نحن هنا لمساعدتك! تواصل معنا في أي وقت
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="px-8 py-3 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors"
            >
              تواصل معنا
            </Link>
            <Link
              href="/"
              className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-colors"
            >
              تسوق الآن
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <section className="py-8 bg-gray-100">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          <p>© 2026 أسواق سيتي المركزية. جميع الحقوق محفوظة.</p>
          <div className="flex justify-center gap-4 mt-2">
            <Link href="/privacy" className="hover:text-primary">سياسة الخصوصية</Link>
            <span>|</span>
            <Link href="/terms" className="hover:text-primary">الشروط والأحكام</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
