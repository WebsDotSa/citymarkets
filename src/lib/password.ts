/**
 * Password hashing helpers.
 *
 * Renamed from `auth.ts` on 2026-09-23 because the original name was
 * ambiguous — the project has FOUR distinct auth concerns:
 *
 *   - password.ts             → hashing only (bcrypt)  ← this file
 *   - customer-session.ts      → JWT signing/verifying + cookie/Bearer
 *   - admin-session.ts         → admin JWT
 *   - vendor-auth.ts           → vendor JWT + role checks
 *   - admin-api-auth.ts        → requireAdminApi(request, perm)
 *   - bearer-auth.ts           → Bearer/cookie extraction
 *
 * Keep this file doing exactly one thing: bcrypt round-trip. If you
 * find yourself wanting to add `signJwt`, `getServerUser`, or
 * `requireAuth` here, push back: those belong in the modules above.
 */
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
