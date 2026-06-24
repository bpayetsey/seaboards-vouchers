---
name: stripe-replit-sync setup gotchas
description: Non-obvious failures when wiring the Replit Stripe connector + stripe-replit-sync in an esbuild-bundled API server.
---

# Stripe connector field names
The Replit Stripe connection (`connector_names=stripe`, `/api/v2/connection?include_secrets=true`) returns `settings` with keys: `account_id`, `secret`, `publishable`, `mcp`, `claim_url`.
- Use `settings.secret` as the secret key and `settings.publishable` as the publishable key.
- There is NO `webhook_secret` field. Do not depend on one.
**Why:** the stripe skill's `stripeClient.ts` template reads `secret_key`/`publishable_key`/`webhook_secret`, which silently fail ("missing secret key") against this connector's actual shape.

# Webhook signature verification uses the managed webhook secret
Since the connector exposes no webhook secret, verify webhooks via `stripeSync.processWebhook(payload, signature)` — stripe-replit-sync stores the managed webhook's signing secret in the DB (`stripe._managed_webhooks`) after `findOrCreateManagedWebhook`. Do NOT call `stripe.webhooks.constructEvent(..., webhookSecret)` with a connector-provided secret.
**How to apply:** for custom business logic on top of sync, call `sync.processWebhook` first (verifies + syncs), then `JSON.parse(payload)` — it's already verified — and branch on `event.type`.

# esbuild must externalize stripe-replit-sync
`runMigrations` resolves its SQL migration dir as `path.resolve(import.meta.url dir, "./migrations")` and **silently skips** (creating an empty `stripe` schema, no tables, no error) if the dir is missing. esbuild bundling collapses `import.meta.url` to the output bundle path, so migrations are never found.
**Fix:** add `"stripe-replit-sync"` to the `external` array in the API server's `build.mjs`. It's a declared dependency and resolves from node_modules at runtime.
**Symptom:** server logs `relation "stripe.accounts" does not exist` during `findOrCreateManagedWebhook`, while the `stripe` schema exists but is empty.
