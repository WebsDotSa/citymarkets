'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';

export interface UseAudioRecorderResult {
  recording: boolean;
  recordingMs: number;
  audioUrl: string | null;
  audioDuration: number | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearRecording: () => void;
}

/**
 * Shared audio recorder hook for direct orders and chat.
 * Records audio and uploads to R2 with proper CSRF handling.
 * Fixes from previous implementations:
 * - CSRF: uses csrfFetch instead of plain fetch
 * - mimeType: detects supported type (webm → mp4 → default)
 * - stale closure: uses startedAt ref for duration calculation
 * - cleanup: stops recorder/timer/stream on unmount
 * - error handling: shows clear error messages
 */
export function useAudioRecorder(uploadUrl = '/api/v1/upload/audio'): UseAudioRecorderResult {
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Detect supported mimeType (webm → mp4 → default)
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Use browser default
        }
      }

      const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined });
      const chunks: Blob[] = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());

        // Calculate duration using startedAt ref (not stale recordingMs)
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const ext = mimeType === 'audio/mp4' ? 'mp4' : 'webm';
        const fd = new FormData();
        fd.append('file', blob, `voice-${Date.now()}.${ext}`);
        fd.append('kind', 'voice');

        try {
          const up = await csrfFetch(uploadUrl, {
            method: 'POST',
            body: fd,
            credentials: 'include',
          });
          const upData = await up.json();
          if (upData.success) {
            setAudioUrl(upData.url);
            setAudioDuration(duration);
          } else {
            setError(upData.error || 'فشل رفع الملف');
          }
        } catch (err) {
          setError('خطأ في رفع الملف: ' + (err as Error).message);
        }
      };

      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecordingMs(0);
      startedAtRef.current = Date.now();

      // Use setInterval to track elapsed time and enforce 60s max
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setRecordingMs(elapsed);
        if (elapsed >= 60000) {
          stopRecording();
        }
      }, 100);
    } catch (err) {
      setError('تعذر الوصول للميكروفون: ' + (err as Error).message);
    }
  }, [uploadUrl, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const clearRecording = useCallback(() => {
    setAudioUrl(null);
    setAudioDuration(null);
  }, []);

  return {
    recording,
    recordingMs,
    audioUrl,
    audioDuration,
    error,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
