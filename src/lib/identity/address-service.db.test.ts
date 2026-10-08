/**
 * Real-Postgres regression tests for address-service.
 *
 * Runs only when RUN_DB_TESTS=1 against a migrated throwaway database
 * (CI sets this after `npm run db:migrate`). The name guard below makes
 * it impossible to point these writes at a non-test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const RUN = process.env.RUN_DB_TESTS === "1";
const DB_NAME = process.env.DATABASE_NAME ?? "";
if (RUN && !/^(ci_|test)/.test(DB_NAME)) {
  throw new Error(`RUN_DB_TESTS refuses database "${DB_NAME}" (must start with ci_ or test)`);
}

describe.skipIf(!RUN)("address-service (real Postgres)", async () => {
  const { pool } = await import("@/lib/db");
  const svc = await import("./address-service");
  const userId = randomUUID();

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO users (id, phone, name) VALUES ($1, $2, 'addr-test') ON CONFLICT DO NOTHING`,
      [userId, `+9665${String(Date.now()).slice(-8)}`],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM addresses WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  const input = { label: "home", lat: 24.7, lng: 46.7, address_text: "Riyadh" };

  it("creates a user-owned address (owner value is a bound parameter)", async () => {
    const row = await svc.createAddress({ kind: "user", userId }, input);
    expect(row.user_id).toBe(userId);
    expect(row.is_default).toBe(true); // first address auto-promotes
  });

  it("a second default demotes the first — exactly one default remains", async () => {
    await svc.createAddress({ kind: "user", userId }, { ...input, is_default: true });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM addresses WHERE user_id = $1 AND is_default`,
      [userId],
    );
    expect(rows[0].c).toBe(1);
  });

  it("rejects an injection-shaped guest key before any SQL runs", async () => {
    const evil = `x'), ('00000000-0000-0000-0000-000000000000'::uuid, 'pwn', 0, 0, 'pwn', true, '{}') --`;
    await expect(
      svc.createAddress({ kind: "guest", guestKey: evil }, input),
    ).rejects.toBeInstanceOf(svc.InvalidAddressOwnerError);
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM addresses WHERE label = 'pwn'`);
    expect(rows[0].c).toBe(0);
  });

  it("rejects a non-uuid user id", async () => {
    await expect(
      svc.createAddress({ kind: "user", userId: "1; DROP TABLE addresses" }, input),
    ).rejects.toBeInstanceOf(svc.InvalidAddressOwnerError);
  });
});
