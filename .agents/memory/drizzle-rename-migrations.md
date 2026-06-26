---
name: Drizzle DDL that prompts can't flow through task/merge/publish
description: Why a Drizzle column rename — or adding a UNIQUE constraint to a populated column — silently fails to reach dev and prod, and the reliable fix paths.
---

# Adding a UNIQUE constraint to a populated column also breaks push

`drizzle-kit push` prompts (TTY-only) whenever it adds a `UNIQUE` constraint to a table that already has rows ("Do you want to truncate <table>?"), even when existing values are unique or NULL. In the non-interactive post-merge/publish environment this aborts the whole push — the same failure mode as a rename.

**The fix that works for dev AND prod (no manual SQL per environment):** do the rollout in an **idempotent backfill script** that runs *before* `pnpm --filter db push` in `scripts/post-merge.sh`. The script must:
1. `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS ...` (nullable).
2. Backfill the new column for all rows.
3. Add the unique constraint under **drizzle's exact generated name** `<table>_<column>_unique`, guarded by `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)` in a `DO $$ ... $$` block.

Because the DB now matches the Drizzle schema, the subsequent `push` sees no diff and never prompts. Keep `.unique()` in the Drizzle schema (so the contract is declarative) — the script just gets the DB there first. Constraint name must match drizzle's convention exactly or push will still try to add it.

**Why:** the schema declares `.unique()` on a column added to tables that already had rows; without pre-applying the constraint, the first post-merge push hangs on the truncate prompt and silently leaves prod unmigrated.

# Drizzle column renames break the automated migration flow

A Drizzle column **rename** (e.g. `active_emailed_at` → `voucher_emailed_at`) cannot be applied by the normal task → merge → publish flow. It will silently fail and leave BOTH dev and prod databases on the old schema, causing runtime 500s ("column does not exist").

**Why:**
- `drizzle-kit push` (the dev-side + post-merge step, `pnpm --filter db push`) detects rename-vs-drop+add as ambiguous and calls `promptColumnsConflicts`, which **requires a TTY**. The post-merge environment is non-interactive, so the whole push aborts — none of the migration applies (not even unrelated column ADDs in the same push).
- Task agents work in **isolated databases**; only their *code* merges back. The main dev DB is only ever updated by the post-merge push — which keeps failing on the rename. So no task can fix the main dev DB schema for a rename.
- Publish diffs **dev DB vs prod DB**. If dev was never migrated, dev and prod are identical → publish applies nothing → prod stays broken. Re-publishing does nothing.

**How to apply (the only reliable fix):**
1. As main agent in **Build mode**, apply the rename directly to the dev DB via SQL: `ALTER TABLE <t> RENAME COLUMN <old> TO <new>;` (read-only/plan mode can't do this).
2. Run `pnpm --filter db push` — now the only remaining diffs are plain column ADDs, which don't prompt, so push succeeds.
3. Verify the failing endpoint returns non-500 (e.g. dashboard `/api/dashboard` should return 401 auth, not 500).
4. Tell the user to **re-Publish**. The Publish UI will show a rename-confirmation prompt (dev has new col, prod has old) — they MUST confirm it as a rename so prod data isn't dropped. Never script DDL against production.
