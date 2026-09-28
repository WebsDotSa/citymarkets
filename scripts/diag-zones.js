const { Client } = require("pg");
const c = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});
c.connect().then(() =>
  c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
    ["delivery_zones"]
  )
).then((r) => {
  console.log("ZONE_COLUMNS=" + r.rows.map((x) => x.column_name).join(","));
  return c.query("SELECT count(*)::int AS n FROM delivery_zones");
}).then((r) => {
  console.log("ZONE_COUNT=" + r.rows[0].n);
  return c.end();
}).catch((e) => { console.error("ERR=" + e.message); process.exit(1); });
