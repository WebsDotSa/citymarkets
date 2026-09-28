import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    // Default LOG_LEVEL/NODE_ENV: dev mode → debug enabled
    delete process.env.LOG_LEVEL;
    delete (process.env as any).NODE_ENV;

    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  it("in development, all four levels log through to console", async () => {
    (process.env as any).NODE_ENV = "development";
    delete process.env.LOG_LEVEL;
    const logger = await import("./logger");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("boom"));
    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("includes the message text and level in the formatted line", async () => {
    (process.env as any).NODE_ENV = "development";
    const logger = await import("./logger");
    logger.info("hello-world");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const out = (infoSpy.mock.calls[0] as unknown[])[0] as string;
    expect(out).toContain("hello-world");
    expect(out).toMatch(/\[INFO\]/);
  });

  it("includes meta as a JSON suffix when provided", async () => {
    (process.env as any).NODE_ENV = "development";
    const logger = await import("./logger");
    logger.info("with-meta", { userId: "abc", count: 3 });
    const out = (infoSpy.mock.calls[0] as unknown[])[0] as string;
    expect(out).toContain('"userId":"abc"');
    expect(out).toContain('"count":3');
  });

  it("omits the meta suffix when no meta is passed", async () => {
    (process.env as any).NODE_ENV = "development";
    const logger = await import("./logger");
    logger.info("plain");
    const out = (infoSpy.mock.calls[0] as unknown[])[0] as string;
    expect(out.endsWith("plain")).toBe(true);
  });

  it("in production, debug/info are suppressed and warn/error pass through", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.LOG_LEVEL;
    const logger = await import("./logger");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("x"));
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("respects explicit LOG_LEVEL (e.g. LOG_LEVEL=error suppresses warn)", async () => {
    (process.env as any).NODE_ENV = "development";
    process.env.LOG_LEVEL = "error";
    const logger = await import("./logger");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("x"));
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("includes the error message and stack in the error meta", async () => {
    (process.env as any).NODE_ENV = "development";
    const logger = await import("./logger");
    const err = new Error("boom");
    logger.error("oops", err, { userId: "u1" });
    const out = (errorSpy.mock.calls[0] as unknown[])[0] as string;
    expect(out).toContain("oops");
    expect(out).toContain("boom");
    expect(out).toContain(err.stack?.split("\n")[0] ?? "");
  });

  it("coerces non-Error error values to a string", async () => {
    (process.env as any).NODE_ENV = "development";
    const logger = await import("./logger");
    logger.error("weird", { code: 500 });
    const out = (errorSpy.mock.calls[0] as unknown[])[0] as string;
    expect(out).toContain("[object Object]");
  });

  describe("createRequestLogger", () => {
    it("prefixes every message with the request id", async () => {
      (process.env as any).NODE_ENV = "development";
      const logger = await import("./logger");
      const rl = logger.createRequestLogger("req-123");
      rl.info("started");
      const out = (infoSpy.mock.calls[0] as unknown[])[0] as string;
      expect(out).toContain("[req-123] started");
    });

    it("forwards error + meta to the underlying error()", async () => {
      (process.env as any).NODE_ENV = "development";
      const logger = await import("./logger");
      const rl = logger.createRequestLogger("r1");
      rl.error("oops", new Error("x"), { userId: "u" });
      const out = (errorSpy.mock.calls[0] as unknown[])[0] as string;
      expect(out).toContain("[r1] oops");
      expect(out).toContain("u");
    });
  });

});