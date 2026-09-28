import { describe, it, expect, afterEach } from "vitest";
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioVerifyServiceSid,
  getTwilioMessagingServiceSid,
  getTwilioAuthHeader,
  isTwilioVerifyConfigured,
  isTwilioMessagingConfigured,
  isTwilioConfigured,
} from "./twilio-config";

const ORIGINAL = { ...process.env };

function clearTwilioEnv() {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_VERIFY_SERVICE_SID;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
}

afterEach(() => {
  // Restore original env after each test
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL)) {
    process.env[k] = v;
  }
});

describe("twilio-config env helpers (unset)", () => {
  it("getTwilioAccountSid returns undefined", () => {
    clearTwilioEnv();
    expect(getTwilioAccountSid()).toBeUndefined();
  });

  it("getTwilioAuthToken returns undefined", () => {
    clearTwilioEnv();
    expect(getTwilioAuthToken()).toBeUndefined();
  });

  it("getTwilioVerifyServiceSid returns undefined", () => {
    clearTwilioEnv();
    expect(getTwilioVerifyServiceSid()).toBeUndefined();
  });

  it("getTwilioMessagingServiceSid returns undefined", () => {
    clearTwilioEnv();
    expect(getTwilioMessagingServiceSid()).toBeUndefined();
  });

  it("getTwilioAuthHeader throws", () => {
    clearTwilioEnv();
    expect(() => getTwilioAuthHeader()).toThrow(/twilio_not_configured/);
  });

  it("isTwilioVerifyConfigured returns false", () => {
    clearTwilioEnv();
    expect(isTwilioVerifyConfigured()).toBe(false);
  });

  it("isTwilioMessagingConfigured returns false", () => {
    clearTwilioEnv();
    expect(isTwilioMessagingConfigured()).toBe(false);
  });

  it("isTwilioConfigured returns false", () => {
    clearTwilioEnv();
    expect(isTwilioConfigured()).toBe(false);
  });
});

describe("twilio-config env helpers (set)", () => {
  it("trims whitespace from each value", () => {
    process.env.TWILIO_ACCOUNT_SID = "  ACSID123  ";
    process.env.TWILIO_AUTH_TOKEN = "  token  ";
    process.env.TWILIO_VERIFY_SERVICE_SID = "  VSID  ";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "  MSID  ";
    expect(getTwilioAccountSid()).toBe("ACSID123");
    expect(getTwilioAuthToken()).toBe("token");
    expect(getTwilioVerifyServiceSid()).toBe("VSID");
    expect(getTwilioMessagingServiceSid()).toBe("MSID");
  });

  it("returns undefined for empty/whitespace-only env vars", () => {
    process.env.TWILIO_ACCOUNT_SID = "   ";
    expect(getTwilioAccountSid()).toBeUndefined();
  });

  it("builds Basic auth header from sid:token", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "yyy";
    const expected = "Basic " + Buffer.from("ACxxx:yyy").toString("base64");
    expect(getTwilioAuthHeader()).toBe(expected);
  });

  it("isTwilioVerifyConfigured is true when verify creds + service sid set", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VS";
    expect(isTwilioVerifyConfigured()).toBe(true);
    expect(isTwilioConfigured()).toBe(true);
  });

  it("isTwilioMessagingConfigured is true when messaging creds + service sid set", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MS";
    expect(isTwilioMessagingConfigured()).toBe(true);
    expect(isTwilioConfigured()).toBe(true);
  });

  it("isTwilioConfigured is true when only verify is configured (no messaging)", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VS";
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    expect(isTwilioConfigured()).toBe(true);
  });

  it("isTwilioConfigured is true when only messaging is configured (no verify)", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MS";
    expect(isTwilioConfigured()).toBe(true);
  });

  it("isTwilioVerifyConfigured is false when one credential is missing", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    expect(isTwilioVerifyConfigured()).toBe(false);
  });

  it("isTwilioMessagingConfigured is false when one credential is missing", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "auth";
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    expect(isTwilioMessagingConfigured()).toBe(false);
  });
});
