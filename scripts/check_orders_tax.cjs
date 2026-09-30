const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='orders' ORDER BY ordinal_position");
  console.log('ORDERS columns (' + r.rows.length + '):');
  for (const row of r.rows) console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable})`);
  const tax = r.rows.find(r => r.column_name === 'tax');
  console.log('---');
  console.log('tax column exists:', !!tax);
  if (tax) console.log('tax type:', tax.data_type);
  await c.end();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
