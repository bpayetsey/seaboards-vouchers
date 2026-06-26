/**
 * Idempotent migration + backfill for human-readable order numbers.
 *
 * Runs the order_number rollout in a way that is safe for the automated
 * task/merge/publish flow (which calls `drizzle-kit push` non-interactively):
 *
 *  1. Adds the nullable `order_number` column to both order tables if missing.
 *  2. Fills any NULL `order_number` with a fresh unique reference.
 *  3. Adds the unique constraint under drizzle's expected name.
 *
 * Because this brings the database fully in line with the Drizzle schema, the
 * subsequent `pnpm --filter db push` sees no diff and never hits the
 * interactive "truncate table?" prompt that adding a UNIQUE constraint to a
 * populated column would otherwise trigger. Safe to run repeatedly.
 */

import { pool, newOrderNumber } from "@workspace/db";

async function migrateTable(table: "store_order" | "group_order"): Promise<number> {
  await pool.query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS order_number text`,
  );

  const existing = await pool.query<{ order_number: string }>(
    `SELECT order_number FROM ${table} WHERE order_number IS NOT NULL`,
  );
  const used = new Set(existing.rows.map((r) => r.order_number));

  const missing = await pool.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE order_number IS NULL`,
  );

  for (const row of missing.rows) {
    let candidate = newOrderNumber();
    while (used.has(candidate)) {
      candidate = newOrderNumber();
    }
    used.add(candidate);
    await pool.query(`UPDATE ${table} SET order_number = $1 WHERE id = $2`, [
      candidate,
      row.id,
    ]);
  }

  const constraint = `${table}_order_number_unique`;
  await pool.query(
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = '${constraint}'
       ) THEN
         ALTER TABLE ${table}
           ADD CONSTRAINT ${constraint} UNIQUE (order_number);
       END IF;
     END $$;`,
  );

  return missing.rows.length;
}

async function main(): Promise<void> {
  const store = await migrateTable("store_order");
  const group = await migrateTable("group_order");
  console.log(
    `Order-number backfill complete: store_order +${store}, group_order +${group}.`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Order-number backfill failed:", err);
  process.exit(1);
});
