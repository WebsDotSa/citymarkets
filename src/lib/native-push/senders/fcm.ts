// Firebase Cloud Messaging (FCM) sender.
//
// Real send implementation lands when `firebase-admin` (v1 API) is
// added as a dependency. Until then the sender returns
// `{status:"skipped", reason:"sender_not_implemented"}` so the
// dispatcher can distinguish env-missing from sender-pending in
// `broadcast_deliveries.error_message`.

import { isFcmSenderConfigured } from "@/lib/env";
import type {
  NativePushSender,
  SendRequest,
  SendOutcome,
} from "./types";

export class FcmSender implements NativePushSender {
  isConfigured(): boolean {
    return isFcmSenderConfigured();
  }

  describeConfiguration(): string {
    return "FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON (v1) or FCM_SERVER_KEY (legacy)";
  }

  async send(_req: SendRequest): Promise<SendOutcome> {
    // Real send implementation deferred — see module header.
    return { status: "skipped", reason: "sender_not_implemented" };
  }
}
