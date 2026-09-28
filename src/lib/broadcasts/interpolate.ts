// Template interpolation — turns `{var_name}` placeholders into concrete
// values for one recipient. Variable names follow the template's declared
// `variables` list (validated at template create time).

export interface InterpolationContext {
  user: {
    id: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    loyalty_points?: number | null;
    loyalty_tier?: string | null;
  };
  broadcast: {
    title: string;
    body: string;
    body_html?: string | null;
    image_url?: string | null;
    cta_label?: string | null;
    cta_url?: string | null;
  };
}

const VAR_RE = /\{([a-z][a-z0-9_]{0,30})\}/gi;

function resolve(name: string, ctx: InterpolationContext): string {
  switch (name) {
    case "customer_name":
      return ctx.user.name ?? "عميلنا";
    case "customer_phone":
      return ctx.user.phone ?? "";
    case "customer_email":
      return ctx.user.email ?? "";
    case "loyalty_points":
      return String(ctx.user.loyalty_points ?? 0);
    case "loyalty_tier":
      return ctx.user.loyalty_tier ?? "";
    case "broadcast_title":
      return ctx.broadcast.title;
    default:
      return "";
  }
}

export function interpolate(
  text: string | null | undefined,
  ctx: InterpolationContext,
): string {
  if (!text) return "";
  return text.replace(VAR_RE, (_, name: string) => resolve(name.toLowerCase(), ctx));
}

export interface ResolvedPayload {
  web_push?: { title: string; body: string; url?: string };
  native_push?: { title: string; body: string; url?: string };
  sms?: { body: string };
  email?: { subject: string; html: string };
  in_app?: { title: string; body: string; url?: string };
}

export function resolveTemplateContent(
  content: Record<string, unknown> | null | undefined,
  ctx: InterpolationContext,
): ResolvedPayload {
  const out: ResolvedPayload = {};
  const wp = content?.["web_push"] as { title?: string; body?: string } | undefined;
  if (wp) {
    out.web_push = {
      title: interpolate(wp.title, ctx),
      body: interpolate(wp.body, ctx),
      url: ctx.broadcast.cta_url ?? undefined,
    };
  }
  const np = content?.["native_push"] as { title?: string; body?: string } | undefined;
  if (np) {
    out.native_push = {
      title: interpolate(np.title, ctx),
      body: interpolate(np.body, ctx),
      url: ctx.broadcast.cta_url ?? undefined,
    };
  }
  const sm = content?.["sms"] as { body?: string } | undefined;
  if (sm) out.sms = { body: interpolate(sm.body, ctx) };
  const em = content?.["email"] as { subject?: string; html?: string } | undefined;
  if (em) {
    out.email = {
      subject: interpolate(em.subject, ctx),
      html: interpolate(em.html, ctx),
    };
  }
  const ia = content?.["in_app"] as { title?: string; body?: string; url?: string } | undefined;
  if (ia) {
    out.in_app = {
      title: interpolate(ia.title, ctx),
      body: interpolate(ia.body, ctx),
      url: ia.url ?? ctx.broadcast.cta_url ?? undefined,
    };
  }
  return out;
}