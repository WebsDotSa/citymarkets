'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Mic, Square, Loader2 } from 'lucide-react';
import { BRAND } from '@/lib/brand-theme';

export interface ChatMessage {
  id: string;
  sender_type: 'customer' | 'admin' | 'system';
  sender_user_id?: string | null;
  sender_admin_id?: string | null;
  admin_name?: string | null;
  customer_name?: string | null;
  body?: string | null;
  audio_url?: string | null;
  audio_duration?: number | null;
  message_kind: 'text' | 'audio' | 'image' | 'system';
  created_at: string;
}

interface ChatPanelProps {
  orderId: string;
  /** Either 'customer' (uses /api/v1/orders/[id]/messages) or 'admin' (uses /api/admin/orders/[id]/messages). */
  perspective: 'customer' | 'admin';
  /** Pull-to-refresh interval in ms (default 8000). */
  pollMs?: number;
  /** Disable send (e.g. terminal order statuses). */
  disabled?: boolean;
  disabledReason?: string;
  /** Initial messages so the panel renders without waiting for the first poll. */
  initial?: ChatMessage[];
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDuration(seconds?: number | null): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    orderId,
    perspective,
    pollMs = 8000,
    disabled = false,
    disabledReason,
    initial = [],
  } = props;

  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const baseUrl =
    perspective === 'admin'
      ? `/api/admin/orders/${orderId}/messages`
      : `/api/v1/orders/${orderId}/messages`;

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(baseUrl, { credentials: 'include' });
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setMessages(data.messages as ChatMessage[]);
        setError(null);
      }
    } catch {
      // Silent — keep last known messages.
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchMessages();
    const t = setInterval(fetchMessages, pollMs);
    return () => clearInterval(t);
  }, [fetchMessages, pollMs]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function sendText() {
    if (!text.trim()) return;
    if (disabled) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim(), message_kind: 'text' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل الإرسال');
      setText('');
      await fetchMessages();
    } catch (err) {
      setError((err as Error).message || 'تعذر الإرسال');
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1000) {
          setRecording(false);
          return;
        }
        const durationSec = Math.max(1, Math.round(recordingMs / 1000));
        const fd = new FormData();
        fd.append('file', blob, `voice-${Date.now()}.webm`);
        fd.append('kind', 'voice');
        try {
          setSending(true);
          const up = await fetch('/api/v1/upload/audio', { method: 'POST', body: fd, credentials: 'include' });
          const upData = await up.json();
          if (!upData.success || !upData.url) throw new Error('فشل رفع الصوت');
          const res = await fetch(baseUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio_url: upData.url,
              audio_duration: durationSec,
              message_kind: 'audio',
            }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'فشل الإرسال');
          await fetchMessages();
        } catch (err) {
          setError((err as Error).message || 'تعذر رفع الصوت');
        } finally {
          setSending(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecordingMs(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingMs((ms) => {
          if (ms >= 60000) {
            stopRecording();
            return ms;
          }
          return ms + 100;
        });
      }, 100);
    } catch (err) {
      setError('تعذر الوصول للميكروفون');
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(false);
    if (recordTimerRef.current !== null) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 text-white text-sm font-semibold flex items-center justify-between"
        style={{ backgroundColor: BRAND.brandGreen }}
      >
        <span>المحادثة</span>
        <span className="text-xs opacity-80">طلب #{orderId.slice(0, 8)}</span>
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
        style={{ backgroundColor: '#f8fafc', minHeight: 320, maxHeight: 480 }}
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12">لا توجد رسائل بعد</div>
        )}
        {messages.map((m) => {
          if (m.message_kind === 'system') {
            return (
              <div key={m.id} className="text-center text-xs text-gray-500 py-1">
                <span className="bg-gray-100 rounded-full px-3 py-1">{m.body}</span>
              </div>
            );
          }
          const mine = (perspective === 'customer' && m.sender_type === 'customer') ||
            (perspective === 'admin' && m.sender_type === 'admin');
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'rounded-bl-sm' : 'rounded-br-sm'
                }`}
                style={{
                  backgroundColor: mine ? BRAND.brandGreen : '#ffffff',
                  color: mine ? '#fff' : '#111',
                  border: mine ? 'none' : '1px solid #e5e7eb',
                }}
              >
                {!mine && (m.sender_type === 'admin' || m.sender_type === 'customer') && (
                  <div className="text-[10px] text-gray-400 mb-1">
                    {m.sender_type === 'admin' ? m.admin_name || 'الإدارة' : 'العميل'}
                  </div>
                )}
                {m.message_kind === 'audio' && m.audio_url ? (
                  <audio
                    controls
                    src={m.audio_url}
                    className="w-full"
                    style={{ height: 32 }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                )}
                <div
                  className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-gray-400'}`}
                >
                  {fmtTime(m.created_at)} {m.message_kind === 'audio' && `· ${fmtDuration(m.audio_duration)}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {disabled ? (
        <div className="px-4 py-3 text-center text-xs text-gray-500 border-t border-gray-200 bg-gray-50">
          {disabledReason || 'لا يمكن إرسال رسائل'}
        </div>
      ) : (
        <div className="border-t border-gray-200 p-3 bg-white">
          {error && (
            <div className="text-xs text-red-600 mb-2">{error}</div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={sending}
              className={`p-2 rounded-full ${
                recording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-700'
              }`}
              aria-label={recording ? 'إيقاف التسجيل' : 'تسجيل صوتي'}
            >
              {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendText();
                }
              }}
              placeholder={recording ? `جاري التسجيل ${fmtDuration(Math.round(recordingMs / 1000))}` : 'اكتب رسالة...'}
              disabled={sending || recording}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-green-500 max-h-24"
              rows={1}
            />
            <button
              type="button"
              onClick={sendText}
              disabled={sending || !text.trim() || recording}
              className="p-2 rounded-full text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND.brandGreen }}
              aria-label="إرسال"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}