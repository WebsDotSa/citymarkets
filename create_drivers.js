/**
 * Script to create 5 delivery driver accounts and insert them into the database.
 *
 * SECURITY:
 *  - Generated passwords are written ONLY to a .driver-passwords-<ts>.txt
 *    file with mode 0600 in the project root — never printed to stdout.
 *    CI log capture is the #1 source of leaked initial credentials, so
 *    printing them was a serious regression.
 *  - The output file is added to .gitignore so the secrets never get
 *    committed. Operators must `cat` the file and `shred` it after
 *    handing the credentials to drivers.
 *  - Passwords are random 16-character strings (upper/lower/digit/symbol),
 *    not predictable patterns like `Driver@2026${i}` that any attacker
 *    who knew the script existed could guess.
 *
 * Run with: node create_drivers.js
 */

require('dotenv').config({ path: '.env.local' });
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { writeFileSync, chmodSync } = require('fs');
const { randomBytes } = require('crypto');

const SALT_ROUNDS = 12;

const drivers = [
  { name: 'أحمد محمد', email: 'driver1@citymarkets.sa', phone: '0501234001' },
  { name: 'محمد خالد', email: 'driver2@citymarkets.sa', phone: '0501234002' },
  { name: 'عبدالله فهد', email: 'driver3@citymarkets.sa', phone: '0501234003' },
  { name: 'سعود ناصر', email: 'driver4@citymarkets.sa', phone: '0501234004' },
  { name: 'فهد عبدالله', email: 'driver5@citymarkets.sa', phone: '0501234005' },
];

/**
 * Generate a 16-character cryptographically-random password from a
 * alphabet that satisfies typical password-policy requirements
 * (uppercase, lowercase, digit, symbol).
 */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;

  // Guarantee at least one of each class so the password passes any
  // reasonable complexity check, then fill the rest from the full
  // alphabet. `randomBytes` is CSPRNG-backed.
  const required = [
    upper[randomBytes(1)[0] % upper.length],
    lower[randomBytes(1)[0] % lower.length],
    digits[randomBytes(1)[0] % digits.length],
    symbols[randomBytes(1)[0] % symbols.length],
  ];
  const tail = randomBytes(12);
  const rest = Array.from(tail, (b) => all[b % all.length]);
  return [...required, ...rest].join('');
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function createDriverAccounts() {
  console.log('========================================');
  console.log('   إنشاء حسابات مناديب التوصيل');
  console.log('   أسواق سيتي - City Markets');
  console.log('========================================\n');

  // Database connection
  const client = new Client({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'citymarket_db',
    user: process.env.DATABASE_USER || 'citymarket_user',
    password: process.env.DATABASE_PASSWORD || '',
  });

  // Hold generated passwords in memory only — never echo to stdout.
  // At the end we write them to a 0600 file and tell the operator the
  // path. Print, log capture, CI history all stay clean.
  const generated = [];

  try {
    await client.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات\n');

    console.log('┌────┬──────────────────┬──────────────────────┬────────────────┐');
    console.log('│ #  │ الاسم             │ البريد                │ الحالة          │');
    console.log('├────┼──────────────────┼──────────────────────┼────────────────┤');

    // Single transaction for the whole loop so a drivers-link failure
    // rolls back the admin_users row (defense in depth — see CLAUDE.md
    // "vendor-create flow must be transactional"; same principle here).
    await client.query('BEGIN');

    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];
      const password = generatePassword();
      const passwordHash = await hashPassword(password);

      // Check if driver already exists
      const existing = await client.query(
        'SELECT id FROM admin_users WHERE email = $1',
        [driver.email]
      );

      let adminUserId;
      let status;
      if (existing.rows.length > 0) {
        adminUserId = existing.rows[0].id;
        // Update existing driver
        await client.query(
          `UPDATE admin_users SET
            name = $1,
            password_hash = $2,
            phone = $3,
            role = 'delivery_driver',
            is_active = true,
            updated_at = NOW()
          WHERE email = $4`,
          [driver.name, passwordHash, driver.phone, driver.email]
        );
        status = '✓ تم التحديث';
      } else {
        // Insert new driver and read back the generated id
        const ins = await client.query(
          `INSERT INTO admin_users (name, email, password_hash, role, phone, is_active, created_at)
           VALUES ($1, $2, $3, 'delivery_driver', $4, true, NOW())
           RETURNING id`,
          [driver.name, driver.email, passwordHash, driver.phone]
        );
        adminUserId = ins.rows[0].id;
        status = '✓ تم الإنشاء';
      }

      // Maintain the drivers table so /api/admin/driver/orders scoping
      // and the PATCH driver_id assignment have a row to point at.
      // Bug history: prior versions only wrote admin_users, leaving the
      // drivers table empty; see migrations/069_backfill_drivers_admin_link.sql.
      await client.query(
        `INSERT INTO drivers (name, phone, status, admin_user_id)
         VALUES ($1, $2, 'available'::driver_status_enum, $3)
         ON CONFLICT (phone) DO UPDATE
           SET admin_user_id = EXCLUDED.admin_user_id,
               name = EXCLUDED.name
         WHERE drivers.admin_user_id IS NULL`,
        [driver.name, driver.phone, adminUserId]
      );

      generated.push({ name: driver.name, email: driver.email, password });
      // SECURITY: never print the password column. Status only.
      console.log(`│ ${i + 1}  │ ${driver.name.padEnd(16)} │ ${driver.email.padEnd(22)} │ ${status.padEnd(14)} │`);
    }

    await client.query('COMMIT');

    console.log('└────┴──────────────────┴──────────────────────┴────────────────┘');

    console.log('\n✅ تم إنشاء جميع حسابات المناديب بنجاح!\n');

    // SECURITY: write the credentials to a mode-0600 file so the operator
    // can `cat` them once and hand them to each driver. The file path
    // is timestamped so re-running the script doesn't overwrite an
    // existing credentials file. `.driver-passwords-*.txt` is
    // git-ignored so secrets never enter the repo.
    const outPath = `.driver-passwords-${Date.now()}.txt`;
    const header = [
        'بيانات اعتماد مناديب التوصيل — سري',
        `Generated: ${new Date().toISOString()}`,
        'يُرجى تسليم البيانات للسائقين شخصيًا وتغيير كلمات المرور لاحقًا.',
        '',
      ].join('\n');
    const body = generated
      .map((d, i) => `${i + 1}. ${d.name}\n   البريد: ${d.email}\n   كلمة المرور: ${d.password}`)
      .join('\n\n');
    writeFileSync(outPath, header + body + '\n', { mode: 0o600 });
    chmodSync(outPath, 0o600);

    console.log('========================================');
    console.log('   معلومات إضافية');
    console.log('========================================\n');
    console.log('🔗 رابط لوحة التحكم: https://citymarkets.sa/admin/login');
    console.log('📱 رابط صفحة السائق: https://citymarkets.sa/admin/driver');
    console.log(`\n🔐 كلمات المرور كُتبت في: ${outPath}`);
    console.log('   (mode 0600 — افتح الملف مرة واحدة لتوزيعها، ثم احذفه بأمان)');
    console.log('\n⚠️  ملاحظات:');
    console.log('   - كلمات المرور مؤقتة - يُنصح بتغييرها');
    console.log('   - كل سائق يمكنه فقط رؤية طلبات التوصيل المخصصة له');
    console.log('   - السائقون يظهرون في لوحة التحكم الرئيسية للمدراء');

  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    // Best-effort rollback; ignore if transaction already ended.
    try { await client.query('ROLLBACK'); } catch { /* no-op */ }
    process.exit(1);
  } finally {
    await client.end();
  }
}

createDriverAccounts();
