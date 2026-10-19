'use strict';
// Read-only verification against the configured application database.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
async function main() {
  if (!process.env.DATABASE_URL) { console.log(JSON.stringify({ configured: false })); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    const exists = (await pool.query("SELECT to_regclass('public.technical_products') AS name")).rows[0]?.name;
    if (!exists) { console.log(JSON.stringify({ catalog_table_exists: false, pending_application_startup: true })); return; }
    const { rows } = await pool.query("SELECT account_id,count(*)::int AS products,count(*) FILTER(WHERE price_basis='distribution')::int AS distribution_products FROM technical_products GROUP BY account_id ORDER BY account_id");
    console.log(JSON.stringify({ catalog_table_exists: true, accounts: rows }));
  } catch (error) { console.log(JSON.stringify({ verification: 'unavailable', code: error.code || error.name })); process.exitCode = 1; }
  finally { await pool.end(); }
}
main();
