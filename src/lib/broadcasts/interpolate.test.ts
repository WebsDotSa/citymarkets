import { describe, it, expect } from "vitest";
import { interpolate, resolveTemplateContent, type InterpolationContext } from "./interpolate";

const ctx: InterpolationContext = {
  user: {
    id: "u-1",
    name: "سارة",
    phone: "+966500000000",
    email: "sara@example.com",
    loyalty_points: 120,
    loyalty_tier: "gold",
  },
  broadcast: {
    title: "عرض اليوم",
    body: "خصم 20%",
    body_html: "<p>خصم</p>",
    cta_url: "https://citymarkets.sa/offers",
  },
};

describe("interpolate", () => {
  it("replaces known variables in title and body", () => {
    expect(interpolate("مرحباً {customer_name}", ctx)).toBe("مرحباً سارة");
    expect(interpolate("{loyalty_points} نقطة", ctx)).toBe("120 نقطة");
    expect(interpolate("{broadcast_title}: {loyalty_tier}", ctx)).toBe("عرض اليوم: gold");
  });

  it("returns empty string for null/undefined input", () => {
    expect(interpolate(null, ctx)).toBe("");
    expect(interpolate(undefined, ctx)).toBe("");
    expect(interpolate("", ctx)).toBe("");
  });

  it("replaces unknown variables with empty string", () => {
    expect(interpolate("Hi {nonexistent_var}!", ctx)).toBe("Hi !");
  });

  it("falls back to default for missing customer_name", () => {
    const fallback = { ...ctx, user: { ...ctx.user, name: null } };
    expect(interpolate("مرحباً {customer_name}", fallback)).toBe("مرحباً عميلنا");
  });

  it("is case-insensitive on variable name", () => {
    expect(interpolate("{CUSTOMER_NAME} | {Loyalty_Tier}", ctx)).toBe("سارة | gold");
  });

  it("preserves unmatched braces that do not match the variable pattern", () => {
    expect(interpolate("Hello { world }", ctx)).toBe("Hello { world }");
    expect(interpolate("{customer_name} {", ctx)).toBe("سارة {");
  });
});

describe("resolveTemplateContent", () => {
  it("returns empty when content is null/undefined", () => {
    expect(resolveTemplateContent(null, ctx)).toEqual({});
    expect(resolveTemplateContent(undefined, ctx)).toEqual({});
  });

  it("resolves each channel payload with interpolation", () => {
    const r = resolveTemplateContent(
      {
        web_push: { title: "Hi {customer_name}", body: "{loyalty_points} pts" },
        sms: { body: "Hello {customer_name}" },
        email: { subject: "Sub {customer_name}", html: "<p>{loyalty_tier}</p>" },
        in_app: { title: "t", body: "b", url: "/x" },
      },
      ctx,
    );
    expect(r.web_push?.title).toBe("Hi سارة");
    expect(r.web_push?.body).toBe("120 pts");
    expect(r.sms?.body).toBe("Hello سارة");
    expect(r.email?.subject).toBe("Sub سارة");
    expect(r.email?.html).toBe("<p>gold</p>");
    expect(r.in_app?.url).toBe("/x");
  });

  it("falls back to broadcast cta_url when in_app url not set", () => {
    const r = resolveTemplateContent(
      { in_app: { title: "t", body: "b" } },
      ctx,
    );
    expect(r.in_app?.url).toBe("https://citymarkets.sa/offers");
  });
});
