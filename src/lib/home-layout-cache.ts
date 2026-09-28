/**
 * In-process cache wrapper for the home layout public reads.
 *
 * Mirrors the pattern used by `/api/v1/categories` (`categories:all:v7`):
 * versioned key + invalidate on admin save. Multi-instance deployments
 * would swap this for Redis, but the invalidation API stays the same.
 *
 * TTL is short (60s) so even if an invalidation is missed the layout
 * converges within a minute. Admin PUTs always call `invalidateHomeLayout`.
 */
import { cache } from "@/lib/cache";
import type { DeviceType } from "@/lib/home-layout-types";

const HOME_LAYOUT_CACHE_KEY = (device: DeviceType, version: string) =>
  `home_layout:${device}:${version}` as const;

const HOME_LAYOUT_TTL_MS = 60_000;

export function getCachedHomeLayout<T>(
  device: DeviceType,
  version: string,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  return cache.getOrSet(HOME_LAYOUT_CACHE_KEY(device, version), fetcher, HOME_LAYOUT_TTL_MS);
}

/**
 * Invalidate both device layouts — admin edits usually affect both so we
 * just clear both keys to keep things simple. Cheap (one in-process Map).
 */
export function invalidateHomeLayout(): void {
  cache.invalidatePattern("home_layout:");
}

export { HOME_LAYOUT_CACHE_KEY };