"use client";

import { getApiErrorMessage } from "@/lib/api-error";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  MapPin,
  Clock,
  Phone,
  Send,
  CheckCircle,
  ChevronDown,
  Star,
  Heart,
  Gift,
  TrendingUp,
  Upload,
  FileText,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";

const JOBS = [
  {
    id: "delivery",
    title: "سائق توصيل",
    icon: "🚚",
    location: "الرياض - حي النرجس",
    type: "دوام كامل",
    salary: "5,000 - 7,000 ر.س",
    description: "توصيل الطلبات للعملاء داخل الرياض",
    requirements: [
      "رخصة قيادة سارية",
      "سيارة خاصة أو دراجة نارية",
      "خبرة في التوصيل مفضلة",
      "التعامل اللائق مع العملاء",
    ],
    color: "bg-blue-50 border-blue-200",
    accent: "text-blue-600",
  },
  {
    id: "picker",
    title: "جامع طلبات",
    icon: "📦",
    location: "الرياض - المستودع المركزي",
    type: "دوام كامل",
    salary: "4,000 - 5,500 ر.س",
    description: "جمع وتجهيز الطلبات من المستودع",
    requirements: [
      "القدرة على حمل أوزان متوسطة",
      "الاهتمام بالتفاصيل",
      "الالتزام بالمواعيد",
      "خبرة في المستودعات مفضلة",
    ],
    color: "bg-amber-50 border-amber-200",
    accent: "text-amber-600",
  },
  {
    id: "customer-service",
    title: "خدمة عملاء",
    icon: "💬",
    location: "عن بُعد",
    type: "دوام جزئي",
    salary: "3,000 - 4,500 ر.س",
    description: "الرد على استفسارات العملاء عبر الهاتف والواتساب",
    requirements: [
      "لباقة في التعامل",
      "سرعة في الرد",
      "القدرة على العمل تحت الضغط",
      "ساعات مرنة متاحة",
    ],
    color: "bg-green-50 border-green-200",
    accent: "text-green-600",
  },
  {
    id: "marketing",
    title: "مسوق رقمي",
    icon: "📱",
    location: "عن بُعد",
    type: "دوام جزئي / freelance",
    salary: "4,000 - 8,000 ر.س",
    description: "إدارة حسابات التواصل الاجتماعي وإنشاء المحتوى",
    requirements: [
      "خبرة في التسويق الرقمي",
      "مهارات تصوير وتحرير",
      "القدرة على إنشاء محتوى جذاب",
      "متابعة آخر اتجاهات السوشيال ميديا",
    ],
    color: "bg-purple-50 border-purple-200",
    accent: "text-purple-600",
  },
  {
    id: "warehouse",
    title: "عامل مستودع",
    icon: "🏭",
    location: "الرياض - المستودع المركزي",
    type: "دوام كامل",
    salary: "3,500 - 5,000 ر.س",
    description: "فرز وتخزين المنتجات في المستودع",
    requirements: [
      "القدرة على العمل الوقوف لفترات طويلة",
      "التزام بمعايير السلامة",
      "العمل في بيئة باردة (ثلاجات)",
      "خبرة سابقة في المخازن",
    ],
    color: "bg-cyan-50 border-cyan-200",
    accent: "text-cyan-600",
  },
  {
    id: "packer",
    title: "مُعد طلبات",
    icon: "📋",
    location: "الرياض - المستودع المركزي",
    type: "دوام كامل",
    salary: "3,500 - 5,000 ر.س",
    description: "تعبئة وتغليف الطلبات قبل التوصيل",
    requirements: [
      "الاهتمام بتغليف المنتجات",
      "السرعة والدقة",
      "التعامل مع المواد الغذائية",
      "الالتزام بمعايير النظافة",
    ],
    color: "bg-rose-50 border-rose-200",
    accent: "text-rose-600",
  },
];

const BENEFITS = [
  { icon: <TrendingUp className="w-6 h-6" />, title: "تأمين طبي", desc: "تغطية طبية شاملة لك ولعائلتك" },
  { icon: <Gift className="w-6 h-6" />, title: "خصم على المنتجات", desc: "خصم 20% على جميع منتجاتنا" },
  { icon: <Star className="w-6 h-6" />, title: "بيئة عمل", desc: "فريق ودّي ودعم مستمر" },
  { icon: <Heart className="w-6 h-6" />, title: "مرونة", desc: "ساعات عمل مرنة حسب طبيعة الدور" },
];

type CvState = {
  file: File;
  url: string;
  size: number;
};

const ACCEPTED_CV_EXT = ".pdf,.doc,.docx";
const MAX_CV_SIZE = 8 * 1024 * 1024;

export default function EmploymentPage() {
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [cv, setCv] = useState<CvState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    if (cv) URL.revokeObjectURL(cv.url);
    setForm({ name: "", phone: "", email: "", message: "" });
    setCv(null);
    setError(null);
    setSelectedJob(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = (file: File | null) => {
    setError(null);
    if (!file) {
      if (cv) URL.revokeObjectURL(cv.url);
      setCv(null);
      return;
    }
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (![".pdf", ".doc", ".docx"].includes(ext)) {
      setError("نوع الملف غير مدعوم. الرجاء رفع PDF أو Word");
      return;
    }
    if (file.size > MAX_CV_SIZE) {
      setError("حجم السيرة الذاتية يجب ألا يتجاوز 8 ميجابايت");
      return;
    }
    if (cv) URL.revokeObjectURL(cv.url);
    setCv({ file, url: URL.createObjectURL(file), size: file.size });
  };

  const uploadCv = async (): Promise<{ url: string; filename: string; size: number }> => {
    if (!cv) throw new Error("الرجاء إرفاق السيرة الذاتية");
    const fd = new FormData();
    fd.append("cv", cv.file);
    setUploadProgress("جاري رفع السيرة الذاتية...");
    const res = await fetch("/api/v1/upload/cv", {
      method: "POST",
      body: fd,
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(getApiErrorMessage(json, "فشل رفع السيرة الذاتية"));
    }
    return json.data;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.phone || !selectedJob) return;
    if (!cv) {
      setError("الرجاء إرفاق السيرة الذاتية");
      return;
    }
    setSubmitting(true);
    try {
      const uploaded = await uploadCv();
      setUploadProgress("جاري إرسال الطلب...");
      const res = await fetch("/api/v1/employment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.name,
          phone: form.phone,
          email: form.email || null,
          job_id: selectedJob,
          message: form.message || null,
          cv_url: uploaded.url,
          cv_filename: uploaded.filename,
          cv_size_bytes: uploaded.size,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(getApiErrorMessage(json, "فشل إرسال الطلب"));
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-primary px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <span className="text-white font-bold text-lg">التوظيف</span>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-gradient-to-b from-[#009345] to-[#008c40] px-4 py-10 text-center">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
          <Briefcase className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">انضم لفريقنا</h1>
        <p className="text-white/80 text-sm max-w-xs mx-auto">
          نبحث عن أشخاص متحمسين للانضمام لمشروعنا. قدّم سيرتك الذاتية الآن وكن جزءًا من فريق أسواق سيتي
        </p>
      </div>

      {/* Benefits */}
      <div className="bg-white px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {BENEFITS.map((b, i) => (
            <div key={i} className="text-center p-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
                {b.icon}
              </div>
              <h3 className="font-semibold text-gray-800 text-sm">{b.title}</h3>
              <p className="text-xs text-gray-500 mt-1">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Jobs List */}
      <div className="px-4 py-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">الوظائف المتاحة</h2>
        <div className="space-y-3">
          {JOBS.map((job) => (
            <div
              key={job.id}
              className={`w-full text-right rounded-2xl border transition-all overflow-hidden ${
                selectedJob === job.id
                  ? `${job.color} border-2`
                  : "bg-white border-gray-100 hover:border-gray-200"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedJob(selectedJob === job.id ? null : job.id)}
                className="w-full text-right p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{job.icon}</span>
                    <div>
                      <h3 className="font-semibold text-gray-800">{job.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {job.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {job.type}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${job.accent}`}>{job.salary}</span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${selectedJob === job.id ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </button>

              {selectedJob === job.id && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-200/60">
                  <p className="text-gray-600 text-sm mb-3">{job.description}</p>
                  <h4 className="font-semibold text-gray-800 text-sm mb-2">المتطلبات:</h4>
                  <ul className="space-y-1 mb-4">
                    {job.requirements.map((req, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                        <CheckCircle className={`w-4 h-4 ${job.accent}`} />
                        {req}
                      </li>
                    ))}
                  </ul>

                  <form onSubmit={handleSubmit} className="space-y-2">
                    <input
                      type="text"
                      placeholder="الاسم الكامل *"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary bg-white"
                      required
                    />
                    <input
                      type="tel"
                      placeholder="رقم الجوال *"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary bg-white"
                      required
                      dir="ltr"
                    />
                    <input
                      type="email"
                      placeholder="البريد الإلكتروني (اختياري)"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary bg-white"
                      dir="ltr"
                    />
                    <textarea
                      placeholder="نبذة عن نفسك (اختياري)"
                      value={form.message}
                      onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary resize-none bg-white"
                      rows={3}
                    />

                    {/* CV upload */}
                    <div>
                      <label className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        السيرة الذاتية (PDF أو Word) *
                      </label>

                      {cv ? (
                        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText className="w-5 h-5 text-green-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate" dir="ltr">
                              {cv.file.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(cv.size / 1024).toFixed(0)} ك.ب
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleFile(null)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-white"
                            aria-label="حذف الملف"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                            <Upload className="w-5 h-5 text-primary" />
                          </div>
                          <span className="text-sm font-semibold text-gray-700">
                            اضغط لرفع السيرة الذاتية
                          </span>
                          <span className="text-xs text-gray-500">
                            PDF, DOC, DOCX • حتى 8 ميجابايت
                          </span>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPTED_CV_EXT}
                            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-primary text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {uploadProgress || "جاري الإرسال..."}
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          قدّم سيرتك الذاتية الآن
                        </>
                      )}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Success Modal */}
      {submitted && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">تم استلام طلبك بنجاح!</h3>
            <p className="text-gray-600 text-sm mb-4">
              شكرًا لاهتمامك بالانضمام لفريقنا. سيقوم فريق التوظيف بمراجعة سيرتك الذاتية والتواصل معك خلال أيام.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setSubmitted(false);
                  resetForm();
                }}
                className="w-full bg-primary text-white py-3 rounded-xl font-semibold"
              >
                قدّم على وظيفة أخرى
              </button>
              <Link
                href="/"
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold"
              >
                العودة للرئيسية
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Contact CTA */}
      <div className="bg-primary px-4 py-8 text-center">
        <h3 className="text-white font-bold text-lg mb-2">تريد التواصل مباشرة؟</h3>
        <p className="text-white/80 text-sm mb-4">تواصل معنا عبر واتساب لأي استفسار</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="https://wa.me/966530444976"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-white text-primary py-3 px-6 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            تواصل واتساب
          </a>
          <a
            href="tel:+966530444976"
            className="flex items-center justify-center gap-2 bg-white/20 text-white py-3 px-6 rounded-xl font-semibold hover:bg-white/30 transition-colors"
          >
            <Phone className="w-5 h-5" />
            اتصل الآن
          </a>
        </div>
      </div>

      {/* Footer Note */}
      <div className="bg-gray-100 px-4 py-4 text-center">
        <p className="text-gray-500 text-xs">
          أسواق سيتي المركزية • الرياض، حي النرجس
        </p>
      </div>
    </div>
  );
}
