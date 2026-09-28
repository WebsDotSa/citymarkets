"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "done"
  | "error";

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult:
    | ((e: {
        results: {
          length: number;
          [i: number]: { isFinal: boolean; 0: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  const recognitionRef = useRef<{ stop: () => void; start: () => void } | null>(
    null
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef({ final: "", interim: "" });
  const recordingRef = useRef(false);

  useEffect(() => {
    transcriptRef.current = { final: transcript, interim: interimTranscript };
  }, [transcript, interimTranscript]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (timerRef.current) clearInterval(timerRef.current);
    recordingRef.current = false;
    setState("idle");
    setTranscript("");
    setInterimTranscript("");
    setRecordingTime(0);
    setError("");
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setTranscript("");
    setInterimTranscript("");
    setRecordingTime(0);
    transcriptRef.current = { final: "", interim: "" };

    const win = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? win.SpeechRecognition || win.webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognitionCtor) {
      setError("المتصفح لا يدعم التعرف على الصوت. جرّب Chrome أو Safari.");
      setState("error");
      return;
    }

    setState("requesting");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "ar-SA";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        recordingRef.current = true;
        setState("recording");
        timerRef.current = setInterval(() => {
          setRecordingTime((prev) => prev + 1);
        }, 1000);
      };

      recognition.onresult = (event: {
        results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
      }) => {
        let interim = "";
        let final = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        if (final) {
          setTranscript(final);
          transcriptRef.current.final = final;
        }
        setInterimTranscript(interim);
        transcriptRef.current.interim = interim;
      };

      recognition.onerror = (event: { error: string }) => {
        if (event.error === "not-allowed") {
          setError("تم رفض صلاحية الميكروفون. يرجى السماح بالوصول.");
          setState("error");
          recordingRef.current = false;
        } else if (event.error !== "aborted") {
          setError("خطأ في التسجيل: " + event.error);
          setState("error");
          recordingRef.current = false;
        }
      };

      recognition.onend = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (!recordingRef.current) return;

        const full = (
          transcriptRef.current.final + transcriptRef.current.interim
        ).trim();

        recordingRef.current = false;

        if (full) {
          setTranscript(full);
          setInterimTranscript("");
          transcriptRef.current = { final: full, interim: "" };
          setState("done");
        } else {
          setState("idle");
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") {
        setError(
          "تم رفض صلاحية الميكروفون. يرجى السماح بالوصول من إعدادات المتصفح."
        );
      } else {
        setError("حدث خطأ أثناء طلب صلاحية الميكروفون.");
      }
      setState("error");
      recordingRef.current = false;
    }
  }, []);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (timerRef.current) clearInterval(timerRef.current);

    const full = (
      transcriptRef.current.final + transcriptRef.current.interim
    ).trim();

    if (full) {
      setTranscript(full);
      setInterimTranscript("");
      transcriptRef.current = { final: full, interim: "" };
      setState("done");
    } else {
      setState("idle");
    }
  }, []);

  const fullTranscript = (transcript + interimTranscript).trim();

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return {
    state,
    transcript,
    interimTranscript,
    fullTranscript,
    displayTranscript: transcript + interimTranscript,
    error,
    recordingTime,
    formatTime,
    startRecording,
    stopRecording,
    reset,
  };
}
