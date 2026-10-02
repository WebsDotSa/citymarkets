/**
 * Rate Limiter with Redis support and in-memory fallback
 * 
 * Uses Redis for distributed rate limiting when REDIS_URL is available,
 * falls back to in-memory Map for single-instance deployments.
 */

import { createClient, type RedisClientType } from 'redis';
import { warn as logWarn, info as logInfo, error as logError } from '@/lib/logger';

// Environment check
const REDIS_URL = process.env.REDIS_URL;

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lastAttempt: number;
}

// In-memory fallback store
const rateLimitStore = new Map<string, RateLimitEntry>();

// Redis client singleton
let redisClient: RedisClientType | null = null;
let redisInitPromise: Promise<void> | null = null;

// Clean up old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt + 60000) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Initialize Redis connection if available
 */
async function initRedis(): Promise<void> {
  if (!REDIS_URL) {
    logWarn('[rate-limit] REDIS_URL not set, using in-memory rate limiting');
    return;
  }

  if (redisClient) return;

  try {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => {
      logError('[rate-limit] Redis error', err);
      redisClient = null;
    });
    await redisClient.connect();
    logInfo('[rate-limit] Redis connected for distributed rate limiting');
  } catch (error) {
    logError('[rate-limit] Failed to connect to Redis, falling back to in-memory', error);
    redisClient = null;
  }
}

/**
 * Get or initialize Redis client
 */
async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) return null;
  
  if (!redisClient) {
    if (!redisInitPromise) {
      redisInitPromise = initRedis();
    }
    await redisInitPromise;
  }
  
  return redisClient;
}

export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Optional prefix for the key
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

/**
 * Check rate limit using Redis (distributed)
 */
async function checkRedisRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const client = await getRedisClient();
  if (!client) {
    return checkInMemoryRateLimit(key, config);
  }

  const now = Date.now();
  const windowSec = Math.ceil(config.windowMs / 1000);

  try {
    // Use Redis MULTI/EXEC for atomic operations
    const multi = client.multi();
    multi.incr(key);
    multi.expire(key, windowSec);
    const results = await multi.exec();
    
    if (!results) {
      // Fallback to in-memory if Redis fails
      return checkInMemoryRateLimit(key, config);
    }

    const count = results[0] as number;
    const ttl = await client.ttl(key);
    const resetAt = ttl > 0 ? now + ttl * 1000 : now + config.windowMs;

    if (count > config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: resetAt - now,
      };
    }

    return {
      allowed: true,
      remaining: config.maxRequests - count,
      resetAt,
    };
  } catch (error) {
    logError('[rate-limit] Redis error, falling back to in-memory', error, { key });
    return checkInMemoryRateLimit(key, config);
  }
}

/**
 * Check rate limit using in-memory Map (single instance)
 */
function checkInMemoryRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const key = `${config.keyPrefix || 'default'}:${identifier}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // If entry doesn't exist or has expired, create new one
  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
      lastAttempt: now,
    };
  }

  // Check if limit exceeded
  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now,
    };
  }

  // Increment counter
  entry.count++;
  entry.lastAttempt = now;
  rateLimitStore.set(key, entry);

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Check rate limit for a given identifier
 * Automatically uses Redis if available, falls back to in-memory
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix || 'default'}:${identifier}`;
  
  // Try Redis first
  const redis = await getRedisClient();
  if (redis) {
    return checkRedisRateLimit(key, config);
  }
  
  // Fallback to in-memory
  return checkInMemoryRateLimit(key, config);
}

/**
 * Synchronous rate limit check (in-memory only)
 * Use this for non-async contexts or when Redis is not critical
 */
export function checkRateLimitSync(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  return checkInMemoryRateLimit(identifier, config);
}

/**
 * Rate limit config for OTP send endpoint
 * - Max 3 OTP requests per phone number per 10 minutes
 */
export const OTP_SEND_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 3,
  keyPrefix: 'otp:send',
};

/**
 * Rate limit config for OTP verify endpoint
 * - Max 5 verify attempts per phone number per 10 minutes
 */
export const OTP_VERIFY_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 5,
  keyPrefix: 'otp:verify',
};

/**
 * Per-IP rate limit for OTP send. Caps cost-amplification attacks where
 * an attacker rotates phone numbers from a single IP to burn the Twilio
 * Verify budget. Independent prefix from OTP_SEND_CONFIG so the phone and
 * IP counters never share a bucket.
 */
export const OTP_SEND_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 10,
  keyPrefix: 'otp:send:ip',
};

/**
 * Per-IP rate limit for OTP verify. The 6-digit code is only 1M
 * combinations, so a single IP spraying codes across many phones needs
 * to be capped independently of the per-phone bucket.
 */
export const OTP_VERIFY_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 20,
  keyPrefix: 'otp:verify:ip',
};

/**
 * Vendor staff OTP rate limits (Phase 3). Distinct keyPrefixes from the
 * customer OTP configs so an attacker hammering customer login can't
 * starve vendor staff, and vice versa. Caps match customer OTP — same
 * 6-digit code, same Twilio budget burn.
 */
export const VENDOR_OTP_SEND_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 3,
  keyPrefix: 'vendor:otp:send',
};

export const VENDOR_OTP_VERIFY_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 5,
  keyPrefix: 'vendor:otp:verify',
};

export const VENDOR_OTP_SEND_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 10,
  keyPrefix: 'vendor:otp:send:ip',
};

export const VENDOR_OTP_VERIFY_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 20,
  keyPrefix: 'vendor:otp:verify:ip',
};

/**
 * Rate limit config for the LEGACY /api/v1/auth/login endpoint (4-digit
 * self-issued OTP, not Twilio Verify). Capped per-phone so a single phone
 * can't keep burning DB rows / cache, AND per-IP so a single client
 * can't fan out across phones (enumeration attack).
 *
 * Twilio Verify endpoints have their own per-phone and per-IP caps
 * (`OTP_SEND_CONFIG`, `OTP_VERIFY_CONFIG`, etc.) — this is the parallel
 * config for the legacy path.
 */
export const LOGIN_LEGACY_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 5,
  keyPrefix: 'login:legacy:phone',
};
export const LOGIN_LEGACY_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 20,
  keyPrefix: 'login:legacy:ip',
};

/**
 * Rate limit config for payment initiation. Each call creates a Moyasar
 * invoice on the gateway — without this cap an authenticated user can
 * spam invoice creation and accrue provider fees. User-keyed because
 * the route is JWT-gated.
 */
export const PAYMENT_INITIATE_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 5,
  keyPrefix: 'payment:initiate:user',
};

/**
 * Secondary IP-level limit on payment initiation. Catches session
 * rotation and any future flow that lets unauthenticated traffic
 * reach the route. Distinct prefix from PAYMENT_INITIATE_CONFIG so the
 * two counters never collide.
 */
export const PAYMENT_INITIATE_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 10,
  keyPrefix: 'payment:initiate:ip',
};

/**
 * BUGFIX (audit 2026-09-29): rate-limit the payment-status poll
 * endpoint. The /checkout/success page polls this every ~3s while the
 * user waits for the gateway webhook to flip the order to `paid`.
 * Without a cap, a malicious or buggy client can hammer it indefinitely.
 *
 * Sized at 60 requests / minute (≈ 1/s) which matches the success-page
 * poll cadence; well above any human-driven polling and well below
 * abusive levels.
 */
export const PAYMENT_STATUS_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  keyPrefix: 'payment:status:user',
};

/**
 * IP-keyed secondary limit on payment-status polling. Same window /
 * quota as the user config but scoped by client IP, so a credential
 * leak alone can't sidestep it. Distinct prefix keeps the two buckets
 * independent.
 */
export const PAYMENT_STATUS_IP_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 120,
  keyPrefix: 'payment:status:ip',
};

/**
 * Rate limit config for order creation endpoint.
 * Sized generously because (a) the checkout flow can fire several
 * legitimate attempts in a single session when the user toggles the
 * payment method / address before settling, and (b) the route already
 * dedupes via the body's `idempotency_key` column, so the actual order
 * count cannot exceed the user's intent.
 * - Max 15 orders per user per 10 minutes
 * - Max 20 orders per IP per 10 minutes (guest checkout, future use)
 */
export const ORDER_CREATE_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 15,
  keyPrefix: 'order:create',
};

/**
 * Rate limit config for cart operations
 * - Max 50 cart operations per user per 10 minutes
 */
export const CART_OPERATION_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 50,
  keyPrefix: 'cart:op',
};

/**
 * Rate limit config for general API operations
 * - Max 100 requests per identifier per minute
 */
export const GENERAL_API_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 100,
  keyPrefix: 'api:general',
};

/**
 * Rate limit config for admin login endpoint
 * - Max 5 login attempts per email per 15 minutes
 * - Max 10 login attempts per IP per 15 minutes
 */
export const ADMIN_LOGIN_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,
  keyPrefix: 'admin:login',
};

/**
 * Rate limit config for admin login by IP
 * - Max 10 login attempts per IP per 15 minutes (broader limit than email)
 */
export const ADMIN_LOGIN_IP_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 10,
  keyPrefix: 'admin:login:ip',
};

/**
 * Broadcast send trigger — caps how many campaigns a single admin can
 * fire (or schedule) in a 10-minute window. A misconfigured template
 * or wrong audience could otherwise burn SMS / email quota in seconds.
 * Admin-keyed; companion IP limit below catches session-rotation abuse.
 */
export const BROADCAST_SEND_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 10,
  keyPrefix: 'broadcast:send',
};

/**
 * Per-IP companion to BROADCAST_SEND_CONFIG.
 */
export const BROADCAST_SEND_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 20,
  keyPrefix: 'broadcast:send:ip',
};

/**
 * Rate limit for the anonymous audio upload endpoint
 * (POST /api/v1/upload/audio). One voice note every ~6s on average;
 * tighter than GENERAL because each upload writes to disk and we don't
 * want a single IP spamming disk space. 10/min is generous for the
 * direct-order chat flow (5–6 voice messages in a row tops).
 */
export const AUDIO_UPLOAD_IP_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'upload:audio:ip',
};

/**
 * Rate limit for the anonymous CV upload endpoint
 * (POST /api/v1/upload/cv). Applicants upload one CV; the form lets
 * them re-attach a different file while editing, so 5/10min per IP is
 * comfortable. Tighter than audio because CVs land in public/images
 * and have no automatic retention.
 */
export const CV_UPLOAD_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'upload:cv:ip',
};

/**
 * Rate limit for the anonymous contact form (POST /api/v1/contact).
 * Same shape as VENDOR_APAP_IP — 5/10min/IP — because both are
 * write-once forms that go into a support inbox.
 */
export const CONTACT_FORM_IP_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'contact:form:ip',
};

/**
 * Rate limit for blog post detail GET (/api/v1/blog/[slug]).
 * The view_count UPDATE is the abuse target — a single bot can
 * inflate view counts and skew editorial metrics. 60/min/IP is well
 * above human read speed but cuts scripted floods. Page is cached for
 * 10 min so legitimate readers almost never exceed this.
 */
export const BLOG_VIEW_IP_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyPrefix: 'blog:view:ip',
};

/**
 * Rate limit for anonymous review submission
 * (POST /api/v1/reviews). Combined with the existing auth check this
 * caps per-IP review spam to 5/min. Authenticated reviewers are not
 * subject to this cap (rate limit is keyed on IP only, and the route
 * accepts either path).
 */
export const REVIEW_SUBMIT_IP_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'reviews:submit:ip',
};

export const REFUND_REQUEST_CONFIG: RateLimitConfig = {
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 3,             // > 3 refund requests / hour / user is suspicious
  keyPrefix: 'refund:request',
};

export const REFUND_REQUEST_IP_CONFIG: RateLimitConfig = {
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,            // > 10 refund requests / hour / IP is suspicious (covers guest flows)
  keyPrefix: 'refund:request:ip',
};

/**
 * Create rate limit response headers
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toString(),
  };

  if (!result.allowed && result.retryAfterMs) {
    headers['Retry-After'] = Math.ceil(result.retryAfterMs / 1000).toString();
  }

  return headers;
}

/**
 * Close Redis connection on shutdown
 */
export async function closeRateLimiter(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisInitPromise = null;
  }
}

/**
 * Test helper: clear the in-memory rate-limit store. Tests that
 * exercise rate-limit behaviour across multiple `it()` blocks must
 * call this in `beforeEach` so a previous test's failure counter
 * does not bleed into the next one. Production code never calls this.
 */
export function __resetRateLimitStoreForTests(): void {
  rateLimitStore.clear();
}
