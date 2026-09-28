// In-process SSE pub/sub. Workers push events; HTTP route handlers keep
// a per-user subscriber list and forward events as `event: <type>\ndata: ...`
// chunks on the Response stream.
//
// Single-instance only (memory-backed). For multi-instance deployments
// (which we don't run today — see memory note), wire Redis pub/sub behind
// the same interface.

export type SseEvent = {
  type: string;
  data: Record<string, unknown>;
  ts?: number;
};

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
};

const encoder = new TextEncoder();
const userSubs = new Map<string, Set<Subscriber>>();
const allSubs = new Set<Subscriber>();

function encode(event: SseEvent): Uint8Array {
  const ts = event.ts ?? Date.now();
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify({ ...event.data, ts })}\n\n`,
  );
}

function deliver(sub: Subscriber, event: SseEvent) {
  try {
    sub.controller.enqueue(encode(event));
  } catch {
    // Controller closed under us — let cleanup remove it.
  }
}

export function publishToUser(userId: string, event: SseEvent): void {
  const subs = userSubs.get(userId);
  if (!subs) return;
  for (const sub of subs) deliver(sub, event);
}

export function publishToAll(event: SseEvent): void {
  for (const sub of allSubs) deliver(sub, event);
}

export function subscribe(
  userId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
): () => void {
  const sub: Subscriber = { controller, encoder };
  let bucket = userSubs.get(userId);
  if (!bucket) {
    bucket = new Set();
    userSubs.set(userId, bucket);
  }
  bucket.add(sub);
  allSubs.add(sub);
  return () => {
    bucket?.delete(sub);
    if (bucket && bucket.size === 0) userSubs.delete(userId);
    allSubs.delete(sub);
  };
}

export function heartbeatComment(
  controller: ReadableStreamDefaultController<Uint8Array>,
): void {
  try {
    controller.enqueue(encoder.encode(`: heartbeat\n\n`));
  } catch {
    // closed
  }
}

// Test-only — not exported via the public surface.
export function __resetSseForTests(): void {
  userSubs.clear();
  allSubs.clear();
}