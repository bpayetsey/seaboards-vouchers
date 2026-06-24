// Runs db/schema.sql against DATABASE_URL. Usage: npm run init-db
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it in Replit Secrets.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Schema applied ✓');
  } catch (e) {
    console.error('Schema failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
