import type { Metadata } from 'next';
import Link from 'next/link';
import { EarningsCalculator } from './earnings-calculator';
import { DelegateRegisterForm } from './delegate-register-form';

// CHROME COVERAGE (2026-09-23): /delegate is a customer-facing
// marketing landing page and INTENTIONALLY receives the global
// customer chrome (HeaderV2 + BottomNavV2 + footer) — see
// `isStorefrontRoute` in @/lib/app-routes. The hero gradient is
// designed to render BELOW the white header, matching /about,
// /contact, /terms and /privacy. Do NOT add this path to the chrome
// deny list — the footer (`footer-v2.tsx`) links here as the driver
// recruitment CTA.

export const metadata: Metadata = {
  title: 'كن مندوب توصيل - أسواق سيتي المركزية',
  description:
    'انضم لفريق مندوبي التوصيل في أسواق سيتي. ساعات مرنة، دخل أسبوعي ثابت، وخصومات حصرية. سجّل الحين وابدأ الكسب.',
  openGraph: {
    title: 'كن مندوب توصيل - أسواق سيتي المركزية',
    description: 'انضم لفريق مندوبي التوصيل - دخل تنافسي وساعات مرنة',
    type: 'website',
  },
};

const STATS = [
  { number: '+800', label: 'مندوب نشط' },
  { number: '+12', label: 'مدينة مغطاة' },
  { number: '4,200', label: 'متوسط الدخل الشهري (ر.س)' },
  { number: '24س', label: 'دفع سريع' },
];

const BENEFITS = [
  {
    icon: '⏰',
    title: 'ساعات مرنة',
    desc: 'اشتغل متى تبي. لا حد أدنى للساعات. مناسب للطلاب أو كعمل إضافي بجانب وظيفتك.',
  },
  {
    icon: '💰',
    title: 'دفعات أسبوعية',
    desc: 'استلم أرباحك كل أسبوع مباشرة في حسابك البنكي. تابع أرباحك لحظة بلحظة من التطبيق.',
  },
  {
    icon: '⛽',
    title: 'خصومات وقود',
    desc: 'خصومات حصرية في محطات الوقود الشريكة. وفّر في كل تعبئة، وزد أرباحك الصافية.',
  },
  {
    icon: '🛡️',
    title: 'تغطية تأمينية',
    desc: 'تأمين شامل أثناء التوصيل. سلامتك أولويتنا في كل رحلة.',
  },
];

const REQUIREMENTS = [
  {
    icon: '🪪',
    title: 'هوية سارية',
    desc: 'هوية سعودية أو إقامة نظامية لغير المواطنين.',
  },
  {
    icon: '🚗',
    title: 'مركبة',
    desc: 'سيارة، دراجة نارية، أو حتى دراجة هوائية.',
  },
  {
    icon: '📄',
    title: 'رخصة قيادة',
    desc: 'رخصة قيادة سارية المفعول لنوع مركبتك.',
  },
  {
    icon: '📱',
    title: 'هاتف ذكي',
    desc: 'آيفون أو أندرويد مع باقة بيانات فعالة.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'سجّل طلبك',
    desc: 'سجّل عبر الموقع وارفع المستندات المطلوبة (هوية، رخصة، ملكية المركبة).',
  },
  {
    n: '2',
    title: 'أكمل التسجيل',
    desc: 'املأ بياناتك وارفع المستندات المطلوبة (هوية، رخصة، ملكية المركبة).',
  },
  {
    n: '3',
    title: 'ابدأ التوصيل',
    desc: 'بعد الموافقة (24-48 ساعة)، سجّل دخولك وابدأ في قبول طلبات التوصيل.',
  },
];

const TESTIMONIALS = [
  {
    name: 'محمد السبيعي',
    role: 'مندوب منذ 2024',
    quote:
      'المرونة في اختيار ساعات الشغل مناسبة لي جداً كطالب. أقدر أشتغل بين المحاضرات وفي عطلات نهاية الأسبوع، والأرباح محترمة.',
  },
  {
    name: 'فهد العنزي',
    role: 'مندوب بدوام كامل منذ 2023',
    quote:
      'أشتغل بالتوصيل بدوام كامل من سنة. التطبيق بسيط، والدعم سريع الاستجابة. الدخل الأسبوعي ثابت ويكفيني وعائلتي.',
  },
  {
    name: 'عبدالله الحربي',
    role: 'مندوب منذ 2024',
    quote:
      'أهم شي عندي الدفع السريع. كل أسبوع أدري متى بالضبط بصير التحويل. خصومات الوقود فوق كذا ساعدتني كثير.',
  },
];

export default function DelegatePage() {
  return (
    <main className="min-h-screen bg-gray-50" dir="rtl" id="main-content">
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-[#009345] to-[#007A38] text-white py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 end-10 w-64 h-64 rounded-full bg-white/20" />
          <div className="absolute bottom-10 start-10 w-48 h-48 rounded-full bg-white/10" />
          <div className="absolute top-1/2 start-1/3 w-32 h-32 rounded-full bg-white/10" />
        </div>
        <div className="max-w-5xl mx-auto px-4 relative z-10 text-center">
          <div className="inline-block bg-white/15 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-semibold mb-6">
            🚴 انضم لفريقنا
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
            اكسب حسب جدولك الخاص
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto mb-8 leading-relaxed">
            انضم لمندوبي التوصيل في أسواق سيتي واستمتع بساعات مرنة، أجر تنافسي، ودفعات أسبوعية.
            كن رئيس نفسك في أنحاء المملكة.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="#register"
              className="px-8 py-4 bg-white text-primary font-bold rounded-xl hover:bg-gray-100 transition-colors shadow-lg"
            >
              سجّل الحين
            </a>
            <a
              href="#requirements"
              className="px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/30 text-white font-bold rounded-xl hover:bg-white/20 transition-colors"
            >
              شاهد المتطلبات ↓
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 md:py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {STATS.map((stat, i) => (
              <div key={i}>
                <div className="text-3xl md:text-4xl font-extrabold text-primary mb-1">
                  {stat.number}
                </div>
                <div className="text-sm md:text-base text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why deliver */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              ليش توصيل مع أسواق سيتي؟
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              انضم لمئات المندوبين اللي يكسبون معنا يومياً في مختلف مدن المملكة.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map((b, i) => (
              <div
                key={i}
                className="bg-white p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-center"
              >
                <div className="text-5xl mb-4">{b.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{b.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Earnings Calculator */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-gray-50 to-primary-50">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-10">
            <div className="inline-block bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-3">
              💡 حاسبة الأرباح
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              شوف كم تقدر تكسب
            </h2>
            <p className="text-gray-600">
              أرباحك تعتمد على مقدار شغلك. استخدم الحاسبة لتقدير دخلك المحتمل.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
            <EarningsCalculator />
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section id="requirements" className="py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              وش تحتاج للبدء؟
            </h2>
            <p className="text-gray-600">متطلبات بسيطة تجعلك على الطريق بسرعة.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {REQUIREMENTS.map((r, i) => (
              <div
                key={i}
                className="relative bg-gray-50 p-6 rounded-2xl hover:bg-primary-50 transition-colors"
              >
                <div className="absolute -top-4 end-6 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">
                  {i + 1}
                </div>
                <div className="text-4xl mb-3 mt-2">{r.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{r.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              ابدأ الكسب في 3 خطوات
            </h2>
            <p className="text-gray-600">سجّل، تمتحن، وابدأ التوصيل.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <div
                key={i}
                className="relative bg-white p-8 rounded-2xl shadow-md border-t-4 border-primary"
              >
                <div className="absolute -top-6 end-6 w-12 h-12 bg-primary text-white rounded-full flex items-center justify-center font-extrabold text-xl shadow-lg">
                  {s.n}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 mt-4">{s.title}</h3>
                <p className="text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              سمع من مندوبينا
            </h2>
            <p className="text-gray-600">تجارب حقيقية من أعضاء فريقنا.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl shadow-sm">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, k) => (
                    <span key={k} className="text-yellow-400 text-lg">
                      ★
                    </span>
                  ))}
                </div>
                <p className="text-gray-700 leading-relaxed mb-5">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                  <div className="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center font-bold text-lg">
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        id="register"
        className="py-16 md:py-24 bg-gradient-to-br from-[#009345] to-[#007A38] text-white"
      >
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">جاهز تبدأ الكسب؟</h2>
          <p className="text-lg md:text-xl text-white/90 mb-8">
            املأ طلب التسجيل وسيتواصل معك فريقنا خلال 24-48 ساعة.
          </p>
          <div className="mb-8">
            <DelegateRegisterForm />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-6 border-t border-white/20">
            <Link
              href="/contact"
              className="px-6 py-2 bg-white/10 backdrop-blur-sm border border-white/30 text-white font-semibold rounded-lg hover:bg-white/20 transition-colors text-sm"
            >
              تواصل معنا
            </Link>
            <Link
              href="/"
              className="px-6 py-2 bg-white text-primary font-semibold rounded-lg hover:bg-gray-100 transition-colors text-sm"
            >
              تصفّح المتجر
            </Link>
          </div>
          <p className="text-xs text-white/70 mt-8">
            * تقديرات فقط. الأرباح الفعلية تختلف بناءً على الوقت والموقع والطلب.
          </p>
        </div>
      </section>
    </main>
  );
}

