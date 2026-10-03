/**
 * Generic HS256 JWT sign/verify helpers.
 *
 * Why this exists
 * ---------------
 * Three near-identical sign/verify pairs lived in:
 *
 *   src/lib/customer-session.ts  → signCustomerToken / verifyCustomerToken
 *   src/lib/admin-session.ts    → signAdminSessionToken / verifyAdminRequest
 *   src/lib/vendor-auth.ts      → signVendorSessionToken / verifyVendorRequest
 *
 * Each of them:
 *   - Built a `SignJWT` with `.setProtectedHeader({ alg: "HS256" })`,
 *     `.setSubject(...)`, `.setIssuedAt()`, `.setIssuer(ISS)`,
 *     `.setAudience(AUD)`, `.setExpirationTime(...)`, `.sign(secretBytes)`.
 *   - Verified with `jwtVerify(..., { issuer, audience, algorithms })`,
 *     swallowed errors, narrowed `payload.sub` and friends to strings,
 *     returned a typed object or null.
 *
 * The boilerplate was duplicated three times. Any change to the issuer
 * format (e.g. switching to RS256, or adding a `kid` header, or
 * tightening algorithm pinning) had to be applied in three places,
 * and they had already drifted subtly (admin used `algorithms: ["HS256"]`,
 * customer did not pin the algorithm, vendor set `sub` to `staffId`
 * instead of a UUID).
 *
 * This helper captures the shared contract. Each issuer module keeps
 * its typed payload + cookie-name + sameSite config, but the sign/verify
 * mechanics live here in one place.
 *
 * Cross-issuer isolation
 * ----------------------
 * The `issuer` (iss) and `audience` (aud) claims act as a defense-in-
 * depth layer: if a customer JWT is ever accidentally signed with the
 * admin secret (or vice versa), the mismatched iss/aud fails
 * verification instead of granting the wrong-role access. Each caller
 * passes its own iss/aud pair so this check stays correct.
 */

import { SignJWT, jwtVerify } from "jose";

export interface SignConfig {
  /** Issuer claim — typically `"citymarket-<role>"`. */
  issuer: string;
  /** Audience claim — typically `"citymarket-<role>-api"`. */
  audience: string;
  /** Secret bytes from `@/lib/env` (e.g. `getCustomerJwtSecretBytes`). */
  secretBytes: Uint8Array;
  /** Expiration — passed verbatim to `setExpirationTime` (e.g. `"7d"`). */
  expirationTime: string;
  /** Key ID (kid) — identifies which secret version signed this token (for rotation support). */
  keyId?: string;
}

export interface VerifyConfig {
  issuer: string;
  audience: string;
  secretBytes: Uint8Array;
}

/**
 * Sign a JWT with the standard city-market claim set:
 * HS256, iat, iss, aud, exp, sub. Returns the encoded JWT string.
 *
 * The `payload` is merged into the standard claims; callers should not
 * set `iat`, `iss`, `aud`, `exp`, or `sub` directly on it (those are
 * overwritten by the helper).
 */
export async function signJwt(
  payload: Record<string, unknown>,
  subject: string,
  config: SignConfig,
): Promise<string> {
  const header: Record<string, string> = { alg: "HS256" };
  if (config.keyId) {
    header.kid = config.keyId;  // Key ID for secret rotation tracking
  }
  return new SignJWT(payload)
    .setProtectedHeader(header)
    .setSubject(subject)
    .setIssuedAt()
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setExpirationTime(config.expirationTime)
    .sign(config.secretBytes);
}

/**
 * Verify a JWT against the issuer + audience + algorithm. Returns the
 * payload (including the standard `sub` claim) or `null` on any failure
 * — bad signature, wrong issuer, wrong audience, expired, or malformed.
 *
 * `algorithms: ["HS256"]` is pinned so a downgrade to `none` (the
 * classic JWT vulnerability) is impossible.
 */
export async function verifyJwt<T extends Record<string, unknown>>(
  token: string,
  config: VerifyConfig,
): Promise<(T & { sub: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, config.secretBytes, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["HS256"],
    });
    return payload as T & { sub: string };
  } catch {
    return null;
  }
}
