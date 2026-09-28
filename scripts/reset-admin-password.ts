// scripts/reset-admin-password.ts
// One-shot script to set/reset a super_admin password.
//
// Usage:
//   ADMIN_EMAIL=admin@citymarkets.sa ADMIN_PASSWORD='YourStrongPass!' \
//     npx tsx scripts/reset-admin-password.ts
//
// Safety: never logs the password. Writes only the bcrypt hash.
// Creates the row if it doesn't exist (with role=super_admin).

import { Client } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function readEnv(name: string, opts: { required?: boolean; fallback?: string } = {}): string {
  const v = process.env[name] ?? opts.fallback;
  if (!v && opts.required) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v ?? "";
}

function genPassword(len = 20): string {
  // URL-safe random password (no ambiguous chars 0/O/1/l/I)
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  const bytes = crypto.randomBytes(len * 2);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function main() {
  const databaseUrl = readEnv("DATABASE_URL", { required: true });
  const email = (readEnv("ADMIN_EMAIL", { fallback: "admin@citymarkets.sa" })).toLowerCase().trim();
  const name = readEnv("ADMIN_NAME", { fallback: "Super Admin" });
  // Either ADMIN_PASSWORD from env, or generate one and PRINT IT ONCE.
  const provided = process.env.ADMIN_PASSWORD;
  const password = provided && provided.length >= 12 ? provided : genPassword(20);
  const generatedHere = !provided;

  const hash = await bcrypt.hash(password, 12);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT id FROM admin_users WHERE LOWER(email) = $1",
      [email]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      await client.query(
        `UPDATE admin_users
            SET password_hash = $1,
                is_active = TRUE,
                updated_at = NOW()
          WHERE LOWER(email) = $2`,
        [hash, email]
      );
      console.log(`✓ Password updated for ${email}`);
    } else {
      await client.query(
        `INSERT INTO admin_users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'super_admin', TRUE)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               is_active = TRUE,
               updated_at = NOW()`,
        [name, email, hash]
      );
      console.log(`✓ Super admin created: ${email}`);
    }

    if (generatedHere) {
      console.log("\n=== SAVE THIS PASSWORD NOW (shown once) ===");
      console.log(password);
      console.log("==========================================\n");
    } else {
      console.log("✓ Password set from ADMIN_PASSWORD env (not echoed).");
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
