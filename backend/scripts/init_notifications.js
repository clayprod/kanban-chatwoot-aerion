require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { createNotificationTables } = require('../notifications');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await createNotificationTables(pool);
  const r = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE tablename IN ('push_subscriptions','notification_preferences','user_notifications')
      ORDER BY 1`
  );
  console.log('tables:', r.rows.map((x) => x.tablename).join(', '));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
