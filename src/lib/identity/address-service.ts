/**
 * Address service — centralised CRUD operations for the `addresses` table.
 *
 * P2-3 (production hardening 2): replaces the duplicated SELECT/INSERT/
 * UPDATE/DELETE statements that previously lived in:
 *   - src/app/api/v1/addresses/route.ts
 *   - src/app/api/v1/addresses/[id]/route.ts
 *   - src/app/api/v1/addresses/[id]/default/route.ts
 *   - src/app/api/v1/delivery-addresses/route.ts
 *
 * Why centralise:
 *   - The four route files had near-identical SQL with subtle drift
 *     (one cast user_id as uuid, another didn't; one path supported
 *     guest_key, the other didn't). The same logic was reimplemented
 *     four times — bugs in one copy were bugs in the others but were
 *     fixed piecemeal.
 *   - Title fallback logic (`title ?? description ?? label`) was
 *     duplicated verbatim in three places.
 *   - is_default-toggle logic was duplicated and the SQL had at least
 *     one instance of `WHERE user_id = $1` without the type cast.
 *
 * Design:
 *   - All functions take an `AddressOwner` discriminated union so the
 *     same service handles both logged-in users and guest sessions
 *     without route-level branching.
 *   - `resolveTitle` is the canonical title-fallback helper — routes
 *     should NOT inline this logic anymore.
 *   - The service returns plain rows (not NextResponse), so callers
 *     remain in control of HTTP shape + status codes.
 *
 * Out of scope (intentional):
 *   - HTTP-level concerns (auth, response shape, status codes) stay in
 *     routes.
 *   - The place_images URL allowlist stays in `@/lib/place-image` —
 *     callers must run `sanitizePlaceImageUrls` before passing values
 *     in. The service enforces the column type but trusts callers to
 *     have validated the URLs.
 */

import { query, pool } from "@/lib/db";

/** Discriminated union — addresses can be owned by a user or a guest session. */
export type AddressOwner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestKey: string };

export interface AddressRow {
  id: string;
  user_id: string | null;
  guest_key: string | null;
  label: string;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  address_text: string | null;
  is_default: boolean;
  place_images: string[] | null;
  created_at: string;
}

export interface AddressInput {
  label: string;
  title?: string | null;
  description?: string | null;
  lat: number;
  lng: number;
  address_text?: string | null;
  is_default?: boolean;
  place_images?: string[] | null;
}

/**
 * Canonical title fallback — title is NOT NULL since migration 049, but
 * older clients may not send it. Resolution order:
 *   1. explicit title (preferred)
 *   2. description
 *   3. label (always present from POST validation)
 *
 * Centralising here means a future change to the fallback policy
 * touches one function instead of N route files.
 */
export function resolveTitle(input: { title?: unknown; description?: unknown; label: string }): string {
  if (typeof input.title === "string" && input.title.trim().length > 0) {
    return input.title.trim();
  }
  if (typeof input.description === "string" && input.description.trim().length > 0) {
    return input.description.trim();
  }
  return input.label;
}

/**
 * Guest keys are client-supplied (x-guest-key header, session_id cookie).
 * Every legitimate generator emits a UUID or `guest_<ms>_<base36>`, so
 * anything outside this whitelist is rejected before it reaches SQL.
 */
const GUEST_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidGuestKey(value: unknown): value is string {
  return typeof value === "string" && GUEST_KEY_RE.test(value);
}

export class InvalidAddressOwnerError extends Error {
  constructor() {
    super("invalid address owner");
    this.name = "InvalidAddressOwnerError";
  }
}

function assertValidOwner(owner: AddressOwner): void {
  const ok =
    owner.kind === "user" ? UUID_RE.test(owner.userId) : isValidGuestKey(owner.guestKey);
  if (!ok) throw new InvalidAddressOwnerError();
}

/**
 * Build the WHERE-clause fragment that scopes an address query to its
 * owner. Returns the SQL fragment and the param value so callers can
 * splice them into larger queries safely.
 */
function ownerWhere(owner: AddressOwner): { sql: string; param: string } {
  assertValidOwner(owner);
  return owner.kind === "user"
    ? { sql: "user_id = $1::uuid", param: owner.userId }
    : { sql: "guest_key = $1", param: owner.guestKey };
}

const SELECT_FIELDS = `
  id,
  user_id::text AS user_id,
  guest_key,
  label,
  title,
  description,
  lat::float8 AS lat,
  lng::float8 AS lng,
  address_text,
  is_default,
  place_images,
  created_at
`;

/** List addresses for an owner, default first. */
export async function listAddresses(owner: AddressOwner): Promise<AddressRow[]> {
  const { sql, param } = ownerWhere(owner);
  const result = await query<AddressRow>(
    `SELECT ${SELECT_FIELDS}
       FROM addresses
      WHERE ${sql}
      ORDER BY is_default DESC, created_at DESC`,
    [param],
  );
  return result.rows;
}

/**
 * Insert a new address. The service:
 *   1. Computes the title via resolveTitle if not explicit
 *   2. If is_default=true (or the owner has no addresses yet), clears
 *      the is_default flag on the owner's other rows before inserting
 *      the new row as default — atomic with the insert via a transaction
 *      so a concurrent insert can't leave two defaults
 *   3. Returns the inserted row
 *
 * Auto-promote-to-default: when this is the owner's first address,
 * the new row is inserted as default regardless of the request flag.
 */
export async function createAddress(
  owner: AddressOwner,
  input: AddressInput,
): Promise<AddressRow> {
  assertValidOwner(owner);
  const title = resolveTitle({ title: input.title, description: input.description, label: input.label });

  // Decide default flag + clear others — wrapped in a transaction so
  // a concurrent INSERT can't race us to two-defaults.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { sql: whereSql, param } = ownerWhere(owner);
    const countResult = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM addresses WHERE ${whereSql}`,
      [param],
    );
    const isFirst = (countResult.rows[0]?.c ?? 0) === 0;
    const makeDefault = input.is_default === true || isFirst;

    if (makeDefault) {
      // SECURITY/PERF: `${whereSql}` is e.g. `user_id = $1::uuid` and is
      // referenced TWICE in the SQL string. pg binds $1 once and reuses
      // the same value for both occurrences — the params array must
      // contain exactly one entry, not two. Passing [param, param] (the
      // previous version) made pg complain "bind message supplies 2
      // parameters, but prepared statement requires 1" because there is
      // only one unique placeholder, even though it appears twice in the
      // text.
      await client.query(
        `UPDATE addresses SET is_default = false WHERE ${whereSql} AND is_default = true`,
        [param],
      );
    }

    // SECURITY: the owner value is always a bound parameter ($1) — it was
    // previously interpolated into the SQL text (SQL injection via the
    // guest key header, and a syntax error for every user-owned insert).
    const ownerColumn = owner.kind === "user" ? "user_id" : "guest_key";
    const ownerCast = owner.kind === "user" ? "::uuid" : "";

    const insertResult = await client.query<AddressRow>(
      `INSERT INTO addresses (${ownerColumn}, label, description, title, lat, lng, address_text, is_default, place_images)
       VALUES ($1${ownerCast}, $2, $3, $4, $5::float8, $6::float8, $7, $8, COALESCE($9::text[], '{}'))
       RETURNING ${SELECT_FIELDS}`,
      [
        param,
        input.label,
        input.description ?? null,
        title,
        input.lat,
        input.lng,
        input.address_text ?? null,
        makeDefault,
        input.place_images ?? null,
      ],
    );

    await client.query("COMMIT");
    return insertResult.rows[0];
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Update an existing address. The id must already belong to the owner
 * (caller passes owner for the ownership check); returns null when the
 * row doesn't exist or isn't owned by the caller.
 *
 * is_default=true clears the flag on the owner's other rows in the
 * same transaction (mirrors createAddress).
 */
export async function updateAddress(
  owner: AddressOwner,
  id: string,
  patch: Partial<AddressInput>,
): Promise<AddressRow | null> {
  const title = resolveTitle({
    title: patch.title,
    description: patch.description,
    label: patch.label ?? " ", // dummy fallback; only used if all fields are null
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { sql: whereSql, param } = ownerWhere(owner);

    if (patch.is_default === true) {
      await client.query(
        `UPDATE addresses SET is_default = false WHERE ${whereSql} AND id <> $2::uuid`,
        [param, id],
      );
    }

    const result = await client.query<AddressRow>(
      `UPDATE addresses
          SET label      = COALESCE($3, label),
              title      = COALESCE(NULLIF($4, ''), title),
              description = COALESCE($5, description),
              lat        = COALESCE($6::float8, lat),
              lng        = COALESCE($7::float8, lng),
              address_text = COALESCE($8, address_text),
              is_default = COALESCE($9, is_default),
              place_images = COALESCE($10::text[], place_images)
        WHERE id = $2::uuid AND ${whereSql}
       RETURNING ${SELECT_FIELDS}`,
      [
        param,
        id,
        patch.label ?? null,
        title,
        patch.description ?? null,
        patch.lat ?? null,
        patch.lng ?? null,
        patch.address_text ?? null,
        patch.is_default ?? null,
        patch.place_images ?? null,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Delete an address. The id must belong to the owner. Returns the
 * number of rows deleted (0 = not found, 1 = deleted). The signature
 * matches the convention used by the postgres `result.rowCount`.
 */
export async function deleteAddress(
  owner: AddressOwner,
  id: string,
): Promise<number> {
  const { sql: whereSql, param } = ownerWhere(owner);
  const result = await query(
    `DELETE FROM addresses WHERE id = $2::uuid AND ${whereSql}`,
    [param, id],
  );
  return result.rowCount ?? 0;
}

/**
 * Set a specific address as default, clearing the flag on the owner's
 * other rows atomically. Returns the updated row or null if the address
 * doesn't exist / isn't owned.
 */
export async function setDefaultAddress(
  owner: AddressOwner,
  id: string,
): Promise<AddressRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { sql: whereSql, param } = ownerWhere(owner);
    await client.query(
      `UPDATE addresses SET is_default = false WHERE ${whereSql} AND id <> $2::uuid`,
      [param, id],
    );

    const result = await client.query<AddressRow>(
      `UPDATE addresses
          SET is_default = true
        WHERE id = $2::uuid AND ${whereSql}
       RETURNING ${SELECT_FIELDS}`,
      [param, id],
    );

    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Resolve an address for an order in one round-trip.
 *
 * Pre-fix: `src/app/api/v1/orders/route.ts` ran FOUR separate SELECTs
 * against the `addresses` table during checkout:
 *
 *   1. fetch the default address id when the caller didn't pass one,
 *   2. verify the supplied `addressId` belongs to the caller,
 *   3. SELECT lat,
 *   4. SELECT lng.
 *
 * Four round-trips meant four awaits on the same row; the helper here
 * collapses them into a single SELECT that returns `{ id, lat, lng }`
 * (the fields the order route actually needs to compute distance).
 *
 * Behaviour:
 *   - When `addressId` is `null` the helper returns the caller's
 *     default address (ties broken by oldest `created_at` to match the
 *     previous ordering).
 *   - When `addressId` is provided the helper enforces ownership in the
 *     WHERE clause — the same rowCount=0 → 400 the route did inline.
 *   - Returns `null` when no row matches (caller's pool of addresses
 *     is empty, or the supplied id isn't owned by them).
 */
export async function resolveOrderAddress(
  userId: string,
  addressId: string | null,
): Promise<{ id: string; lat: number; lng: number } | null> {
  const { rows } = await query<{ id: string; lat: number; lng: number }>(
    addressId
      ? `SELECT id, lat::float8 AS lat, lng::float8 AS lng
          FROM addresses
         WHERE id = $2::uuid AND user_id = $1::uuid`
      : `SELECT id, lat::float8 AS lat, lng::float8 AS lng
          FROM addresses
         WHERE user_id = $1::uuid
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
    [userId, addressId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: String(r.id), lat: Number(r.lat), lng: Number(r.lng) };
}
