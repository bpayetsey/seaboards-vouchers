---
name: Drizzle column renames can't flow through task/merge/publish
description: Why a Drizzle column rename silently fails to reach dev and prod, and the only reliable fix path.
---

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
