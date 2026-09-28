'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { useAuthState } from '@/contexts/auth-context';
import type { Address } from '@/lib/types';
import {
  Mic,
  Square,
  MapPin,
  ChevronLeft,
  CreditCard,
  Wallet,
  Banknote,
  Smartphone,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'دفع نقدي', icon: Banknote },
  { value: 'card', label: 'بطاقة', icon: CreditCard },
  { value: 'stc_pay', label: 'STC Pay', icon: Smartphone },
  { value: 'wallet', label: 'المحفظة', icon: Wallet },
] as const;

const FEE = 4;
const TAX_RATE = 0.15;

export default function DirectOrderCreatePage() {
  const router = useRouter();
  const { user } = useAuthState();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [payment, setPayment] = useState<string>('cash');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ free_text: string; quantity: number }>>([
    { free_text: '', quantity: 1 },
  ]);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeModalOpen, setFeeModalOpen] = useState(false);
  const [feeAcknowledged, setFeeAcknowledged] = useState(false);
  const [config, setConfig] = useState<{ fee: number; notesLimit: number } | null>(null);

  useEffect(() => {
    fetch('/api/v1/orders/direct')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setConfig({ fee: d.fee, notesLimit: d.notesLimit });
      })
      .catch(() => {});
    fetch('/api/v1/delivery-addresses', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.addresses)) {
          setAddresses(d.addresses);
          if (d.addresses.length > 0) setSelectedAddressId(d.addresses[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const duration = Math.max(1, Math.round(recordingMs / 1000));
        const fd = new FormData();
        fd.append('file', blob, `voice-${Date.now()}.webm`);
        fd.append('kind', 'voice');
        const up = await fetch('/api/v1/upload/audio', { method: 'POST', body: fd, credentials: 'include' });
        const upData = await up.json();
        if (upData.success) {
          setVoiceUrl(upData.url);
          setVoiceDuration(duration);
        }
      };
      rec.start();
      (window as unknown as { __rec: MediaRecorder }).__rec = rec;
      setRecording(true);
      setRecordingMs(0);
      const t = window.setInterval(() => {
        setRecordingMs((ms) => {
          if (ms >= 60000) {
            stopRecording();
            return ms;
          }
          return ms + 100;
        });
      }, 100);
      (window as unknown as { __recTimer: number }).__recTimer = t;
    } catch {
      setError('تعذر الوصول للميكروفون');
    }
  }

  function stopRecording() {
    const rec = (window as unknown as { __rec?: MediaRecorder }).__rec;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(false);
    const t = (window as unknown as { __recTimer?: number }).__recTimer;
    if (t) clearInterval(t);
  }

  function addItemRow() {
    setItems((arr) => [...arr, { free_text: '', quantity: 1 }]);
  }

  function removeItemRow(idx: number) {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, patch: Partial<{ free_text: string; quantity: number }>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function submit() {
    if (!selectedAddressId) {
      setError('اختر عنوان التوصيل');
      return;
    }
    if (!feeAcknowledged) {
      setFeeModalOpen(true);
      return;
    }
    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr) {
      setError('العنوان غير صالح');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/orders/direct', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: payment,
          notes: notes.trim() || undefined,
          voice_note_url: voiceUrl || undefined,
          voice_note_duration: voiceDuration || undefined,
          fee_acknowledged: true,
          fee_acknowledged_at: new Date().toISOString(),
          delivery_address: {
            label: addr.label,
            address_text: addr.address_text,
            lat: addr.lat,
            lng: addr.lng,
            plus_code: addr.plus_code,
            city: addr.city,
            district: addr.district,
            place_images: [],
          },
          items: items
            .filter((it) => it.free_text.trim())
            .map((it) => ({
              free_text: it.free_text.trim(),
              quantity: it.quantity,
            })),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل إنشاء الطلب');
      // Open the dedicated chat page (matches "تأكيد الطلب وفتح محادثة مباشرة بعدها")
      router.push(`/orders/direct/chat/${data.orderId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const feeWithVat = +(FEE * (1 + TAX_RATE)).toFixed(2);
  const taxOnly = +(FEE * TAX_RATE).toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50 pb-32" dir="rtl">
      {/* Top bar */}
      <div
        className="sticky top-0 z-10 text-white px-4 py-3 flex items-center gap-3"
        style={{ backgroundColor: BRAND.brandGreen }}
      >
        <button onClick={() => router.back()} aria-label="رجوع" className="p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <div className="font-bold">خدمة الطلب المباشر</div>
          <div className="text-xs opacity-90">
            {user?.name ? `أهلاً ${user.name}، ` : ''}حدّد طلبك وسنوصله لك
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Address */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5" style={{ color: BRAND.brandGreen }} />
              <h2 className="font-bold text-gray-900">عنوان التوصيل</h2>
            </div>
          </div>
          {addresses.length === 0 ? (
            <div className="text-sm text-gray-500">
              لا توجد عناوين محفوظة.{' '}
              <a href="/profile/addresses" className="font-semibold underline" style={{ color: BRAND.brandGreen }}>
                أضف عنواناً
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {addresses.map((a) => (
                <label
                  key={a.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                    selectedAddressId === a.id ? 'border-green-500 bg-green-50' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="addr"
                    value={a.id}
                    checked={selectedAddressId === a.id}
                    onChange={() => setSelectedAddressId(a.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 text-sm">
                    <div className="font-bold">{a.label}</div>
                    <div className="text-gray-600">{a.address_text}</div>
                    {a.plus_code && (
                      <div className="text-xs text-gray-400 mt-1">{a.plus_code}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Items */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900">طلباتك</h2>
            <button
              onClick={addItemRow}
              className="text-sm font-semibold"
              style={{ color: BRAND.brandGreen }}
            >
              + أضف طلباً
            </button>
          </div>
          <div className="space-y-3">
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder="مثال: 5 كيلو طماطم، 2 علبة حليب..."
                  value={it.free_text}
                  onChange={(e) => updateItem(idx, { free_text: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, { quantity: parseInt(e.target.value, 10) || 1 })}
                  className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-center text-sm focus:outline-none focus:border-green-500"
                />
                {items.length > 1 && (
                  <button
                    onClick={() => removeItemRow(idx)}
                    className="px-3 text-red-500 text-sm"
                    aria-label="حذف"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Payment */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200">
          <h2 className="font-bold text-gray-900 mb-3">طريقة الدفع</h2>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = payment === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPayment(opt.value)}
                  className={`flex items-center gap-2 p-3 rounded-xl border ${
                    active ? 'border-green-500 bg-green-50' : 'border-gray-200'
                  }`}
                >
                  <Icon className="w-5 h-5" style={{ color: active ? BRAND.brandGreen : '#666' }} />
                  <span className="text-sm font-semibold">{opt.label}</span>
                  {active && (
                    <CheckCircle2 className="w-4 h-4 mr-auto" style={{ color: BRAND.brandGreen }} />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Notes */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-900">ملاحظات الطلب</h2>
            <span className="text-xs text-gray-400">{notes.length}/700</span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 700))}
            placeholder="أي تفاصيل إضافية تساعد السائق..."
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500"
          />
          <p className="text-xs text-gray-500 mt-2">الحد الأدنى للطلب 0.00 ر.س</p>
        </section>

        {/* Voice */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-900">رسالة صوتية</h2>
            <span className="text-xs text-gray-400">اختياري</span>
          </div>
          {!voiceUrl ? (
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`flex items-center gap-2 w-full justify-center p-3 rounded-xl border ${
                recording ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'
              }`}
            >
              {recording ? <Square className="w-5 h-5 text-red-500" /> : <Mic className="w-5 h-5" />}
              <span className="text-sm font-semibold">
                {recording ? `جاري التسجيل ${Math.round(recordingMs / 1000)} ثانية` : 'سجّل ملاحظة صوتية'}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
              <audio src={voiceUrl} controls className="flex-1" style={{ height: 32 }} />
              <button
                onClick={() => { setVoiceUrl(null); setVoiceDuration(null); }}
                className="text-red-500 text-sm"
              >
                حذف
              </button>
            </div>
          )}
        </section>

        {/* Fee disclosure */}
        <section
          className="rounded-2xl p-4 text-sm"
          style={{ backgroundColor: BRAND.primaryLight, color: BRAND.primaryDark }}
        >
          <div className="font-bold mb-1">رسوم الخدمة</div>
          <div>
            رسوم خدمة الطلب المباشر <strong>{FEE.toFixed(2)} ر.س</strong> (شامل ضريبة القيمة المضافة 15%:{' '}
            {taxOnly.toFixed(2)} ر.س) — يتم تطبيقها بعد تأكيد طلبك وتحديد السعر النهائي.
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full max-w-2xl mx-auto text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ backgroundColor: BRAND.brandGreen }}
        >
          {submitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <span>إرسال الطلب</span>
              <span className="opacity-90 text-sm">
                ({feeWithVat.toFixed(2)} ر.س)
              </span>
            </>
          )}
        </button>
      </div>

      {/* Fee confirmation modal */}
      {feeModalOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5">
            <h3 className="font-bold text-lg mb-2">إشعار رسوم الخدمة</h3>
            <p className="text-sm text-gray-600 mb-4">
              رسوم الخدمة <strong className="text-red-500">{feeWithVat.toFixed(2)} ر.س</strong> شامل ضريبة
              القيمة المضافة. هل تريد تأكيد الطلب؟
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setFeeAcknowledged(true);
                  setFeeModalOpen(false);
                  submit();
                }}
                className="flex-1 text-white font-bold py-2.5 rounded-xl"
                style={{ backgroundColor: BRAND.brandGreen }}
              >
                تأكيد الطلب
              </button>
              <button
                onClick={() => setFeeModalOpen(false)}
                className="flex-1 bg-gray-100 font-bold py-2.5 rounded-xl"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}