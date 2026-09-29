/**
 * Dev auth bypass for local development only
 * SECURITY: Requires explicit AUTH_DEV_BYPASS=true flag in addition to NODE_ENV=development
 * This prevents accidental bypass in production-like environments
 */

import { isProd } from "@/lib/env";

export function isAuthDevBypass(): boolean {
  // Both conditions must be true: we're in dev mode AND bypass is explicitly enabled.
  // `!isProd` is true when NODE_ENV !== "production" (matches the original
  // `IS_DEV = process.env.NODE_ENV === "development"` semantics: any non-prod
  // environment enables the bypass when the operator opts in).
  return !isProd && process.env.AUTH_DEV_BYPASS === "true";
}
