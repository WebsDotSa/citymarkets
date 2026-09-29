# Native push dispatch

This module routes native (iOS / Android) push notifications through a
provider abstraction. It is **distinct** from Web Push — see
`@/lib/push` for the browser-side `web-push` integration.

## What's implemented

| Sender | Status | Source |
|---|---|---|
| **Web Push** (browser) | Implemented end-to-end via `web-push` npm + `@/lib/push` | production |
| **APNs** (iOS native) | Stub — returns `skipped: sender_not_implemented` | `src/lib/native-push/senders/apns.ts` |
| **FCM** (Android native) | Stub — returns `skipped: sender_not_implemented` | `src/lib/native-push/senders/fcm.ts` |

The abstraction (`NativePushSender` interface in
`src/lib/native-push/senders/types.ts`) lets the dispatcher distinguish
the three reasons a delivery might not happen:

```ts
type SendOutcome =
  | { status: "sent"; sent: number; failed: number; externalIds: string[] }
  | {
      status: "skipped";
      reason: "not_configured" | "no_tokens" | "sender_not_implemented";
    };
```

| Reason | Meaning |
|---|---|
| `not_configured` | Required env vars missing (`APNS_*` or `FCM_*`). Operator must populate `.env.local`. |
| `no_tokens` | Sender is configured but the user has no registered device token in `native_push_tokens`. |
| `sender_not_implemented` | Env vars are set but the concrete send code hasn't shipped yet — **this is the current production state**. |

The dispatcher writes the `reason` into `broadcast_deliveries.error_message`
so the admin broadcast metrics panel can tell "config missing" from
"platform ready, integration pending" from "user has no device".

## How to enable a real APNs sender

1. Populate env vars:
   ```
   APNS_KEY_ID=...
   APNS_TEAM_ID=...
   APNS_BUNDLE_ID=...
   APNS_KEY_PATH=/abs/path/to/AuthKey_XXXXXX.p8
   ```
2. Add `apn` (or write a manual HTTP/2 client to `api.push.apple.com`).
3. Replace the body of `ApnsSender.send()` in
   `src/lib/native-push/senders/apns.ts`. The interface contract is:
   ```ts
   send(req: SendRequest): Promise<SendOutcome>
   ```
   `SendRequest.tokens` is already filtered to the iOS platform by the
   dispatcher (see *Multi-device dispatch* below), so the sender can
   iterate the array directly.
4. Add regression tests under `apns.test.ts` covering success,
   `apns-id` extraction, and the canonical `410 — Unregistered`
   "delete this token" path.

## How to enable a real FCM sender

1. Populate env vars (v1 API preferred):
   ```
   FCM_PROJECT_ID=...
   FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   ```
2. Add `firebase-admin` as a dependency.
3. Replace the body of `FcmSender.send()` in
   `src/lib/native-push/senders/fcm.ts` with the
   `messaging.sendEachForMulticast(...)` call.
4. Add regression tests covering success + the legacy `registration_token_not_registered`
   cleanup path.

## Multi-device dispatch (audit K58)

When both APNs and FCM env vars are present, the dispatcher does NOT
pick the first configured sender — it iterates **every** configured
sender and filters tokens by `platform` before each send. The contract
is implemented in `src/lib/native-push.ts:dispatchToAllSenders(...)`:

| User device profile | What happens |
|---|---|
| iOS only | APNs sender receives the iOS token; FCM sender is skipped (no Android tokens) |
| Android only | FCM sender receives the FCM token; APNs sender is skipped |
| **Both iOS + Android** | APNs sender receives the iOS token AND FCM sender receives the Android token — parallel delivery, no silent drop |
| Neither | Returns `no_tokens` without calling either sender |

`selectSenders()` returns the full configured list; `selectSender()`
(singular) is kept as a backward-compat wrapper that returns the first
configured sender for callers that genuinely need at-most-one (tests,
single-platform admin tooling).

## Outcome aggregation

The dispatcher aggregates `sent` / `failed` across senders:

| All senders `sent` | Aggregated result |
|---|---|
| ≥ 1 sent | `{ sent: total, failed: total, skipped: false }` |
| All `skipped: sender_not_implemented` | `{ skipped: true, reason: "sender_not_implemented" }` |
| All `skipped: no_tokens` | `{ skipped: true, reason: "no_tokens" }` |
| Mixed (some sent, some skipped) | `{ sent, failed, skipped: false }` — partial skip absorbed |

This means a "real" APNs sender that successfully delivers to an iOS
user + a "stub" FCM sender that no-ops the Android token still
reports a successful delivery for the iOS half. The admin broadcast
panel will not see a skip row for the partial failure — by design, so
a single failing provider doesn't block the working one.

## Configuration check (read this carefully)

`isNativePushConfigured()` returns `true` when **any one** of APNs /
FCM is configured. It does NOT mean a delivery will happen — the
configured sender may still be a stub returning
`sender_not_implemented`.

Operators adding native push should be aware:
- Setting env vars without implementing the sender → every delivery
  records `skipped: sender_not_implemented` in `broadcast_deliveries`.
- The admin broadcast providers tab surfaces `describeConfiguration()`
  for each sender so an operator can paste the exact env var names
  into `.env.local`.
