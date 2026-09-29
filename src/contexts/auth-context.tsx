"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { User } from "@/lib/types";
import { isAuthDevBypass } from '@/lib/identity';
import { supabase } from "@/lib/supabase/client";
import { warn as logWarn } from "@/lib/logger";

/**
 * Fetches Twilio-OTP toggle state from `/api/v1/auth/config`.
 *
 * Implementation notes (replaces the previous module-scoped boolean cache):
 *   - We dedupe in-flight requests via a single shared promise so concurrent
 *     callers never trigger two network round-trips.
 *   - We no longer pin the resolved value at module scope. Doing so made the
 *     toggle sticky for the lifetime of the JS bundle, so changes an admin
 *     made via the admin panel would not propagate to already-loaded clients.
 *   - State captured into the auth provider via `twilioRef.current` is the
 *     authoritative source within a session — callers that need the latest
 *     value during `verifyOtp` / `refreshUser` consult the ref and only fall
 *     back to a fresh fetch if the ref hasn't been populated yet.
 */
let twilioOtpFetchPromise: Promise<boolean> | null = null;

function fetchTwilioOtpEnabled(): Promise<boolean> {
  if (twilioOtpFetchPromise) return twilioOtpFetchPromise;
  twilioOtpFetchPromise = (async () => {
    try {
      const r = await fetch("/api/v1/auth/config");
      const d = await r.json();
      return Boolean(d.twilioOtp);
    } catch {
      return false;
    } finally {
      // Allow the next caller to re-fetch after the existing in-flight
      // settles, so admin-side toggles eventually propagate.
      twilioOtpFetchPromise = null;
    }
  })();
  return twilioOtpFetchPromise;
}

interface AuthStateValue {
  user: User | null;
  loading: boolean;
  /** true عندما يكون Twilio Verify مفعّلاً على الخادم (لا تلميح «أي رمز») */
  twilioOtpEnabled: boolean;
}

interface AuthActionsValue {
  signIn: (phone: string) => Promise<{ error: string | null }>;
  verifyOtp: (phone: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Re-fetch /api/v1/auth/me and sync the user state to whatever the
   *  cookie says. Use on 401 to reconcile stale optimistic state. */
  refreshUser: () => Promise<User | null>;
}

interface AuthContextType extends AuthStateValue, AuthActionsValue {}

const AuthStateContext = createContext<AuthStateValue | null>(null);
const AuthActionsContext = createContext<AuthActionsValue | null>(null);
const AuthContext = createContext<AuthContextType | null>(null);

const MOCK_USER: User = {
  id: "00000000-0000-0000-0000-000000000001",
  phone: "0551234567",
  name: "أحمد محمد",
  email: null,
  avatar_url: null,
  loyalty_points: 1250,
  loyalty_tier: "silver",
  spin_count_today: 0,
  last_spin_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [twilioOtpEnabled, setTwilioOtpEnabled] = useState(false);
  const twilioRef = useRef(false);

  // Reconcile local user state with what the customer's session cookie
  // says. Returns the user (and updates state) on success, null on failure.
  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      const me = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (!me.ok) {
        setUser(null);
        return null;
      }
      const j = await me.json();
      const u = (j.user ?? null) as User | null;
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const bootstrap = async () => {
      const twilio = await fetchTwilioOtpEnabled();
      if (cancelled) return;
      twilioRef.current = twilio;
      setTwilioOtpEnabled(twilio);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;

        if (session) {
          const { data } = await supabase
            .from("users")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (data) setUser(data as User);
        } else {
          const me = await fetch("/api/v1/auth/me", { credentials: "include" });
          if (me.ok) {
            const j = await me.json();
            if (j.user) setUser(j.user as User);
          } else if (
            isAuthDevBypass() &&
            !twilio &&
            typeof window !== "undefined"
          ) {
            const storedUser = localStorage.getItem("city_market_dev_user");
            if (storedUser) setUser(JSON.parse(storedUser) as User);
          }
        }
      } catch {
        if (
          isAuthDevBypass() &&
          !twilioRef.current &&
          typeof window !== "undefined"
        ) {
          const storedUser = localStorage.getItem("city_market_dev_user");
          if (storedUser) setUser(JSON.parse(storedUser) as User);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(
        async (_event: AuthChangeEvent, session: Session | null) => {
        if (session) {
          const { data } = await supabase
            .from("users")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (data) setUser(data as User);
          return;
        }
        const me = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (me.ok) {
          const j = await me.json();
          if (j.user) {
            setUser(j.user as User);
            return;
          }
        }
        if (
          isAuthDevBypass() &&
          !twilioRef.current &&
          typeof window !== "undefined"
        ) {
          const storedUser = localStorage.getItem("city_market_dev_user");
          if (storedUser) {
            setUser(JSON.parse(storedUser) as User);
            return;
          }
        }
        setUser(null);
      });
      unsubscribe = () => subscription.unsubscribe();
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (phone: string) => {
    const useTwilio = await fetchTwilioOtpEnabled();
    twilioRef.current = useTwilio;
    setTwilioOtpEnabled(useTwilio);

    if (useTwilio) {
      try {
        const res = await fetch("/api/v1/auth/twilio/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            error:
              typeof j.error === "string"
                ? j.error
                : "تعذر إرسال رمز التحقق",
          };
        }
        return { error: null };
      } catch {
        return { error: "تعذر الاتصال بالخادم" };
      }
    }

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phone.startsWith("0") ? `+966${phone.slice(1)}` : phone,
        options: { channel: "sms" },
      });
      if (error) throw error;
      return { error: null };
    } catch (err: unknown) {
      // No dev bypass for sign in - always require real auth
      return { error: "تعذر إرسال رمز التحقق" };
    }
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const useTwilio = await fetchTwilioOtpEnabled();
    twilioRef.current = useTwilio;
    setTwilioOtpEnabled(useTwilio);

    if (useTwilio) {
      try {
        const res = await fetch("/api/v1/auth/twilio/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone, code }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            error:
              typeof j.error === "string"
                ? j.error
                : "رمز التحقق غير صحيح",
          };
        }
        // Reconciliation: confirm the cookie is real by hitting /me rather
        // than trusting `j.user` from the verify response alone. A forged or
        // proxy-stripped Set-Cookie would otherwise let the header show the
        // user as logged in while /api/v1/orders returns 401.
        const me = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (!me.ok) {
          return { error: "تعذر تأكيد الجلسة، حاول مرة أخرى" };
        }
        const meJson = await me.json();
        if (!meJson.user) {
          return { error: "تعذر تأكيد الجلسة، حاول مرة أخرى" };
        }
        setUser(meJson.user as User);
        return { error: null };
      } catch {
        return { error: "تعذر الاتصال بالخادم" };
      }
    }

    try {
      const fullPhone = phone.startsWith("0")
        ? `+966${phone.slice(1)}`
        : phone;
      const { data, error } = await supabase.auth.verifyOtp({
        phone: fullPhone,
        token: code,
        type: "sms",
      });
      if (error) throw error;

      if (data.user) {
        const { data: profile } = await supabase
          .from("users")
          .select("*")
          .eq("id", data.user.id)
          .single();

        if (!profile) {
          await supabase.from("users").insert({
            id: data.user.id,
            phone: fullPhone,
            loyalty_points: 0,
            loyalty_tier: "bronze",
            spin_count_today: 0,
          });
        }
      }

      return { error: null };
    } catch (err: unknown) {
      // Dev bypass is only active if AUTH_DEV_BYPASS=true (requires explicit opt-in)
      if (isAuthDevBypass()) {
        logWarn("[DEV AUTH] OTP verify failed, using mock user", { error: (err as Error).message });
        setUser(MOCK_USER);
        localStorage.setItem("city_market_dev_user", JSON.stringify(MOCK_USER));
        return { error: null };
      }
      return { error: "رمز التحقق غير صحيح أو انتهت صلاحيته" };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem("city_market_dev_user");
  }, []);

  const stateValue = useMemo<AuthStateValue>(
    () => ({ user, loading, twilioOtpEnabled }),
    [user, loading, twilioOtpEnabled]
  );

  const actionsValue = useMemo<AuthActionsValue>(
    () => ({ signIn, verifyOtp, signOut, refreshUser }),
    [signIn, verifyOtp, signOut, refreshUser]
  );

  const combinedValue = useMemo<AuthContextType>(
    () => ({ ...stateValue, ...actionsValue }),
    [stateValue, actionsValue]
  );

  return (
    <AuthActionsContext.Provider value={actionsValue}>
      <AuthStateContext.Provider value={stateValue}>
        <AuthContext.Provider value={combinedValue}>
          {children}
        </AuthContext.Provider>
      </AuthStateContext.Provider>
    </AuthActionsContext.Provider>
  );
}

export function useAuthState(): AuthStateValue {
  const ctx = useContext(AuthStateContext);
  if (!ctx) throw new Error("useAuthState must be used within AuthProvider");
  return ctx;
}

export function useAuthActions(): AuthActionsValue {
  const ctx = useContext(AuthActionsContext);
  if (!ctx) throw new Error("useAuthActions must be used within AuthProvider");
  return ctx;
}

/**
 * @deprecated Prefer `useAuthState()` and `useAuthActions()` for new code.
 */
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
