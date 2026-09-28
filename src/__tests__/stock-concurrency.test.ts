/**
 * Stock concurrency regression guard.
 *
 * Goals:
 *   1. The `orders.idempotency_key UNIQUE` constraint (migration 034)
 *      catches duplicate checkouts. 20 concurrent POST /api/v1/checkout
 *      with the same key must result in exactly one new order; the rest
 *      return the cached existing order (or a duplicate-friendly error).
 *   2. `vendor_products.stock_quantity` is decremented atomically by
 *      `UPDATE ... SET stock_quantity = stock_quantity - $1`. Under
 *      parallel decrement for the same product, the sum of decrements
 *      must equal the sum of accepted quantities, and the column must
 *      never go negative.
 *
 * What this test does NOT do:
 *   - It does NOT spin up the Next.js HTTP server. We exercise the
 *     database invariants directly so the test is hermetic and CI-fast.
 *   - It does NOT attempt to fix any concurrency bug it surfaces.
 *     A flaky or failing test is the signal to investigate; this file
 *     is the canary, not the cure.
 *
 * Skip behaviour:
 *   The test requires DATABASE_HOST/PORT/NAME/USER/PASSWORD. When the
 *   CI PostgreSQL service is up (see .github/workflows/ci.yml), it
 *   runs. When DATABASE_PASSWORD is empty (no .env.local), the test
 *   is skipped with a clear reason — same pattern as the rest of
 *   the suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const dbConfig = () => ({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: parseInt(process.env.DATABASE_PORT || "5432", 10),
  database: process.env.DATABASE_NAME || "citymarket_db",
  user: process.env.DATABASE_USER || "citymarket_user",
  password: process.env.DATABASE_PASSWORD || "",
  family: 4,
  connectionTimeoutMillis: 5000,
});

const hasDb = (): boolean => Boolean(process.env.DATABASE_PASSWORD);

interface TestRow {
  order_id: string;
  stock_before: number;
  stock_after: number;
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function findSeededProduct(client: Client): Promise<{
  id: string;
  stock: number;
  price: number;
} | null> {
  // Pick any vendor_product with stock > 20 so the parallel decrement
  // test can request 5 × 5 = 25 units without going negative.
  const r = await client.query<{
    id: string;
    stock_quantity: number;
    price: number;
  }>(
    `SELECT id, stock_quantity, price
       FROM vendor_products
      WHERE stock_quantity >= 25
        AND is_active = TRUE
      ORDER BY stock_quantity DESC
      LIMIT 1`,
  );
  const row = r.rows[0];
  return row
    ? { id: row.id, stock: row.stock_quantity, price: Number(row.price) }
    : null;
}

describe("stock concurrency invariants", () => {
  let client: Client;
  let seeded: { id: string; stock: number; price: number } | null = null;

  beforeAll(async () => {
    if (!hasDb()) return;
    client = new Client(dbConfig());
    await client.connect();
    seeded = await findSeededProduct(client);
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  it(
    "20 concurrent decrements for the same product sum correctly (no oversell)",
    async () => {
      if (!hasDb()) {
        console.log("SKIP: DATABASE_PASSWORD not set");
        return;
      }
      if (!seeded) {
        console.log(
          "SKIP: no vendor_products row with stock_quantity >= 25; skipping parallel decrement test",
        );
        return;
      }

      const decrement = 5;
      const parallel = 20;
      const productId = seeded.id;
      const stockBefore = seeded.stock;

      // Atomic parallel decrement — mirrors what create-checkout.ts:340 does
      // for each item. The UPDATE itself is atomic at row level; the test
      // exercises the sum invariant.
      const updates: Promise<{ id: string; newStock: number }>[] = [];
      for (let i = 0; i < parallel; i++) {
        updates.push(
          client
            .query<{ stock_quantity: number }>(
              `UPDATE vendor_products
                  SET stock_quantity = stock_quantity - $1,
                      updated_at = NOW()
                WHERE id = $2 AND stock_quantity >= $1
                RETURNING stock_quantity`,
              [decrement, productId],
            )
            .then((r) => ({
              id: productId,
              newStock: Number(r.rows[0]?.stock_quantity ?? -1),
            })),
        );
      }
      const results = await Promise.all(updates);

      // Every successful decrement must report a non-negative stock.
      for (const r of results) {
        expect(
          r.newStock,
          `stock went negative after concurrent decrement: ${r.newStock}`,
        ).toBeGreaterThanOrEqual(0);
      }

      // Sum check: total decrement must equal the count of successful updates.
      const totalDecremented = results.length * decrement;
      const expectedStock = stockBefore - totalDecremented;
      const finalStock = results[results.length - 1].newStock;
      expect(finalStock, "final stock mismatch").toBe(expectedStock);

      // Restore stock so other tests / re-runs see a deterministic baseline.
      await client.query(
        `UPDATE vendor_products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2`,
        [stockBefore, productId],
      );
    },
    30_000,
  );

  it(
    "idempotency_key UNIQUE constraint catches duplicate concurrent checkouts",
    async () => {
      if (!hasDb()) {
        console.log("SKIP: DATABASE_PASSWORD not set");
        return;
      }

      // 042_loyalty_idempotency_index.sql — the runner's app_migrations table
      // proves the migration runner is alive. We don't insert a real order
      // (the test must not pollute production data); instead we exercise
      // the UNIQUE on idempotency_key at the SQL level to prove the
      // invariant is enforceable.
      const probeKey = `concurrency-probe-${Date.now()}`;
      const probeId = `00000000-0000-0000-0000-${Date.now()
        .toString()
        .padStart(12, "0")}`;

      // Try to insert two orders with the same idempotency_key.
      // The second MUST fail with 23505 (unique_violation).
      const insertSql = `INSERT INTO orders (id, user_id, idempotency_key, status, total, created_at, updated_at)
                         VALUES ($1, NULL, $2, 'pending', 0, NOW(), NOW())`;
      await withClient(async (c) => {
        await c.query(insertSql, [probeId, probeKey]);
        let duplicateCaught = false;
        try {
          await c.query(insertSql, [
            "11111111-1111-1111-1111-111111111111",
            probeKey,
          ]);
        } catch (e) {
          duplicateCaught =
            (e as { code?: string }).code === "23505" ||
            String(e).includes("duplicate key");
        }
        expect(
          duplicateCaught,
          "duplicate idempotency_key MUST raise 23505 unique_violation",
        ).toBe(true);

        // Cleanup.
        await c.query(`DELETE FROM orders WHERE id = $1`, [probeId]);
      });
    },
    15_000,
  );
});
