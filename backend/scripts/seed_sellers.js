/* One-shot seed for seller flags + Clayton identity merge. */
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_access (
      user_id INTEGER PRIMARY KEY,
      allowed_views JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_seller BOOLEAN NOT NULL DEFAULT false,
      seller_identity TEXT,
      seller_label TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE app_user_access ADD COLUMN IF NOT EXISTS is_seller BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE app_user_access ADD COLUMN IF NOT EXISTS seller_identity TEXT`);
  await pool.query(`ALTER TABLE app_user_access ADD COLUMN IF NOT EXISTS seller_label TEXT`);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app_user_access WHERE is_seller = true`
  );
  console.log('sellers before', countRows[0]);

  if ((countRows[0]?.n || 0) === 0) {
    const seeds = [
      [1, true, 'clayton', 'Clayton'],
      [2, true, 'clayton', 'Clayton'],
      [8, true, null, null],
      [6, false, null, null],
      [5, false, null, null],
    ];
    for (const [id, isSeller, identity, label] of seeds) {
      await pool.query(
        `INSERT INTO app_user_access (user_id, allowed_views, is_seller, seller_identity, seller_label, updated_at)
         VALUES ($1, '[]'::jsonb, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET
           is_seller = EXCLUDED.is_seller,
           seller_identity = EXCLUDED.seller_identity,
           seller_label = EXCLUDED.seller_label,
           updated_at = now()`,
        [id, isSeller, identity, label]
      );
    }
    console.log('seeded defaults');
  } else {
    console.log('sellers already configured — skip seed');
  }

  const { rows } = await pool.query(
    `SELECT user_id, is_seller, seller_identity, seller_label FROM app_user_access ORDER BY user_id`
  );
  console.log(rows);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
