declare module 'web-push' {
  export interface VapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  export interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  export interface PushPayload {
    title: string;
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
    url?: string;
  }

  export function setVapidDetails(
    vapidDetails: VapidDetails
  ): void;

  export function setGCMAPIKey(key: string): void;

  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | null,
    options?: {
      TTL?: number;
      urgency?: 'very-low' | 'low' | 'normal' | 'high';
      topic?: string;
    }
  ): Promise<unknown>;

  export function generateVAPIDKeys(): {
    publicKey: string;
    privateKey: string;
  };

  export const vapidKeys: {
    publicKey: string;
    privateKey: string;
  } | null;
}
