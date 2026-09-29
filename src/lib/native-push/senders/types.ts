// Provider abstraction for native push senders (APNs / FCM).
//
// Today the codebase only ships a typed stub for both providers — see
// `src/lib/native-push.ts`. This module extracts the abstract shape
// (`NativePushSender`) so that:
//   - tests can pin the contract independently of any concrete sender;
//   - the dispatcher can distinguish "env missing" from "sender pending";
//   - a real HTTP/2 APNs or `firebase-admin` implementation can drop in
//     later without touching the broadcast dispatcher.
//
// New senders MUST implement `NativePushSender` and live under this
// directory. The factory `selectSender()` picks the first configured one.

import type { NativePushPayload } from "@/lib/native-push";

export interface PushToken {
  token: string;
  /** "ios" for APNs, "android" for FCM. */
  platform: "ios" | "android";
}

export interface SendRequest {
  userId: string;
  payload: NativePushPayload;
  tokens: PushToken[];
}

export type SendOutcome =
  | {
      status: "sent";
      sent: number;
      failed: number;
      /** Provider-side message id per delivered token, when available. */
      externalIds: string[];
    }
  | {
      status: "skipped";
      /**
       * Why the send was skipped:
       * - "not_configured" — required env vars missing; check `isConfigured()`.
       * - "no_tokens" — sender is configured but the user has no registered
       *   device tokens.
       * - "sender_not_implemented" — env present, but no concrete sender
       *   implementation has landed yet. This is the expected state today
       *   (see `src/lib/native-push.ts`); the dispatcher records
       *   `native_push_sender_pending` on `broadcast_deliveries`.
       */
      reason: "not_configured" | "no_tokens" | "sender_not_implemented";
    };

export interface NativePushSender {
  /** Quick check used by `selectSender()` to pick a configured provider. */
  isConfigured(): boolean;
  /**
   * Human-readable summary of the env vars this sender needs. Surfaced
   * in the admin broadcast providers tab so an operator can paste the
   * names straight into `.env.local`.
   */
  describeConfiguration(): string;
  /** Send `payload` to every token in `req.tokens`. */
  send(req: SendRequest): Promise<SendOutcome>;
}
