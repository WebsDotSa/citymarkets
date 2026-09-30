#!/usr/bin/env tsx
/**
 * Diagnose Apple Reviewer (+966555555555) account data — read-only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Client } from "pg";

async function main() {
  const host = process.env.DATABASE_HOST || "localhost";
  const port = parseInt(process.env.DATABASE_PORT || "5432", 10);
  const database = process.env.DATABASE_NAME || "citymarket_db";
  const user = process.env.DATABASE_USER || "citymarket_user";
  const password = process.env.DATABASE_PASSWORD || "";

  const client = new Client({ host, port, database, user, password });
  await client.connect();
  try {
    const users = await client.query(
      `SELECT id, phone, name, email, created_at
         FROM users WHERE phone = '+966555555555'`,
    );
    console.log(`Apple Reviewer users: ${users.rows.length}`);
    for (const u of users.rows) {
      console.log(`  - id=${u.id} name=${u.name} email=${u.email} created=${u.created_at?.toISOString?.()}`);
    }

    if (users.rows.length > 0) {
      const userId = users.rows[0].id;
      const addrs = await client.query(
        `SELECT id, title, address_text, lat, lng, created_at
           FROM addresses WHERE user_id = $1`,
        [userId],
      );
      console.log(`\nAddresses (${addrs.rows.length}):`);
      for (const a of addrs.rows) {
        console.log(`  - ${a.id} | title=${a.title} | text=${a.address_text} | (${a.lat}, ${a.lng})`);
      }

      const orders = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM orders WHERE user_id = $1`,
        [userId],
      );
      console.log(`\nOrders count: ${orders.rows[0]?.c}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
