// Test getProductForSeo exactly as the app does it
import { Client } from 'pg';
import { readFileSync } from 'fs';
import 'dotenv/config';

// Load env manually
const envContent = readFileSync('/var/www/citymarkets.sa/city-market-app/.env.local', 'utf8');
const dbUrl = envContent.match(/DATABASE_URL=([^\n]+)/)[1];
process.env.DATABASE_URL = dbUrl;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const sql = `SELECT p.id::text AS id, p.name_ar, p.name_en, p.description, p.image_url,
            p.price::float AS price, p.discount_price::float AS discount_price,
            p.is_active, p.barcode, p.stock_qty,
            c.name_ar AS category_name, c.slug AS category_slug, c.icon_url AS category_icon
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id = $1`;
  try {
    const r = await c.query(sql, ['2f8d950c-253c-4392-8cb7-496115a83636']);
    console.log('rows:', r.rows.length);
    console.log('first row:', JSON.stringify(r.rows[0], null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  }
  await c.end();
})();
