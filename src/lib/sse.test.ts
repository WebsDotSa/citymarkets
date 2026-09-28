import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  publishToUser,
  publishToAll,
  subscribe,
  heartbeatComment,
  __resetSseForTests,
} from "./sse";

type EnqueueFn = (chunk: Uint8Array) => void;
type Controller = {
  enqueue: EnqueueFn;
  close: () => void;
  error?: (e?: unknown) => void;
};

function makeController(): { ctrl: Controller; enqueued: string[] } {
  const enqueued: string[] = [];
  const decoder = new TextDecoder();
  const ctrl: Controller = {
    enqueue: (chunk) => enqueued.push(decoder.decode(chunk)),
    close: () => undefined,
  };
  return { ctrl, enqueued };
}

describe("sse pub/sub", () => {
  beforeEach(() => {
    __resetSseForTests();
    vi.restoreAllMocks();
  });

  it("publishToUser delivers to a subscriber for that user only", () => {
    const a = makeController();
    const b = makeController();
    const unsubA = subscribe("u1", a.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    subscribe("u2", b.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);

    publishToUser("u1", { type: "broadcast", data: { title: "Hi" } });

    expect(a.enqueued.length).toBe(1);
    expect(b.enqueued.length).toBe(0);
    expect(a.enqueued[0]).toMatch(/event: broadcast/);
    expect(a.enqueued[0]).toMatch(/Hi/);

    unsubA();
    publishToUser("u1", { type: "broadcast", data: {} });
    expect(a.enqueued.length).toBe(1); // no further delivery
  });

  it("publishToAll fans out to every subscriber", () => {
    const a = makeController();
    const b = makeController();
    subscribe("u1", a.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    subscribe("u2", b.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    publishToAll({ type: "system", data: { ok: true } });
    expect(a.enqueued.length).toBe(1);
    expect(b.enqueued.length).toBe(1);
  });

  it("heartbeatComment writes a heartbeat line", () => {
    const a = makeController();
    heartbeatComment(a.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    expect(a.enqueued[0]).toMatch(/: heartbeat/);
  });

  it("subscribe returns an unsubscribe fn that removes from user + all", () => {
    const a = makeController();
    const unsub = subscribe("u1", a.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    publishToAll({ type: "x", data: {} });
    expect(a.enqueued.length).toBe(1);
    unsub();
    publishToAll({ type: "x", data: {} });
    expect(a.enqueued.length).toBe(1); // not delivered
  });

  it("delivery to a closed controller does not throw", () => {
    const a = makeController();
    subscribe("u1", a.ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    a.ctrl.enqueue = () => {
      throw new Error("closed");
    };
    expect(() => publishToUser("u1", { type: "x", data: {} })).not.toThrow();
  });
});