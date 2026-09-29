// Apple Push Notification service (APNs) sender.
//
// Real send implementation lands when either the `apn` npm package or a
// manual HTTP/2 client to `api.push.apple.com` is added as a dependency.
// Until then the sender returns `{status:"skipped", reason:"sender_not_implemented"}`
// so the dispatcher can distinguish env-missing from sender-pending in
// `broadcast_deliveries.error_message`.

import { isApnsConfigured } from "@/lib/env";
import type {
  NativePushSender,
  SendRequest,
  SendOutcome,
} from "./types";

export class ApnsSender implements NativePushSender {
  isConfigured(): boolean {
    return isApnsConfigured();
  }

  describeConfiguration(): string {
    return "APNS_KEY_ID + APNS_TEAM_ID + APNS_BUNDLE_ID + APNS_KEY_PATH";
  }

  async send(_req: SendRequest): Promise<SendOutcome> {
    // Real send implementation deferred — see module header.
    return { status: "skipped", reason: "sender_not_implemented" };
  }
}
