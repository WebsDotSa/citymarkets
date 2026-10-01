/**
 * Wishlist limits shared by the server service (`wishlist-service.ts`,
 * authoritative) and the client context (`contexts/wishlist-context.tsx`,
 * guest cache + optimistic UI). Pure module — safe in client bundles.
 */

/** Hard cap per user — protects against accidental bulk inserts. */
export const MAX_WISHLIST_SIZE = 50;
