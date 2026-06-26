---
name: Group Vouchers app
description: Seaboards Golden Jubilee group-voucher app — modes, pricing, Stripe usage, and expiry/sweep rules.
---

# Group Vouchers (Seaboards Golden Jubilee)

Resort group-voucher offer for Seychelles, currency SCR. Lives in `artifacts/group-vouchers` (web, root path) + `artifacts/api-server` (Express) + `lib/db` schema (`groupOrders`, `voucherLines`).

## Order modes
- **independent** — each payer buys their own voucher; each paid line gets its own `voucherCode`. Order becomes `complete` when all lines paid.
- **split** — all-or-nothing shared voucher. Shares are equal-split (remainder on first line) OR explicit `share_minor` that must each be positive and sum to room total. Order `complete` (with a single `splitVoucherCode`) only when every line is paid.
- **flat** — simple per-person links: one `per_person_minor` applied to every line, no apartment/nights. Behaves exactly like independent for payment/voucher/completion/sweep (the server branches on `mode === "split"`, so flat falls into the independent path). Created from the inline storefront "Buying for a group?" section.
- **Names are optional:** `organiser_name`/`payer_name` are nullable in the API; server falls back to the email (`organiser_name || organiser_email`, `l.payer_name || l.payer_email`). The flat storefront form only collects emails + amount.

## Pricing
Default rates major units: `one_bedroom=2300`, `two_bedroom=3750` per night. `MINOR_PER_MAJOR=100`. Amount stored in minor units. `amount = rate * nights * 100`.
- **Editable prices are admin-overridable** via `store_catalog_price` (itemId PK, rate, was). `getEffectiveCatalog()` in `storeCatalog.ts` merges overrides onto the static `CATALOG` defaults (falls back to defaults on DB error). Only the two apartment packages are editable (rate + strikethrough `was`); gift-voucher amounts are buyer-chosen.
- **Single source of truth, no drift:** the effective catalog must feed *every* pricing path. Storefront config + order validation (`priceFor`, async) AND group split pricing (`getRates`/`getRateTable`, async, mapped via `CATALOG_ID_TO_APARTMENT_TYPE`) all derive from it. Never read the static `CATALOG`/`RATES` constants directly in a new pricing flow — add to `getEffectiveCatalog` instead. **Why:** storefront and group order used to duplicate the same hardcoded numbers; an override that only updated one would silently mis-price the other.
- Admin endpoints `GET /admin/catalog-prices` + `PUT /admin/catalog-prices/{itemId}` (staff-gated). Server rejects non-integer/non-positive prices (does NOT round) so behavior matches the "whole positive amounts" error text.

## Stripe
- **Dynamic server-side `price_data` is intentional and correct here** — do NOT use a product catalog, despite the generic Stripe skill saying "never price_data".
- Connector id: `connector:ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y`. Packages: `stripe` + `stripe-replit-sync`.
- Server startup is **resilient**: if Stripe isn't connected, it warns and keeps serving (don't make it throw).
- Webhook registered with `express.raw` BEFORE `express.json`; verified via `stripe.webhooks.constructEvent` with the integration's webhookSecret. Managed webhook auto-registered on boot via `getStripeSync().findOrCreateManagedWebhook(...)`.

## Invariants (enforced after code review)
- Webhook `handleSessionCompleted` only transitions a line when `line.status === "pending"` AND `order.status === "open"` — never resurrect an expired/swept line.
- `startCheckout` reuses an existing open Checkout session for a line before creating a new one (avoids duplicate charges).
- `/api/group-orders/admin/sweep` is protected: requires `Authorization: Bearer <SESSION_SECRET>` (constant-time compare). Never world-callable.

## Server links
API returns RELATIVE links (`/pay/{token}`, `/group/{token}`); Stripe success/cancel URLs are absolute from request origin; frontend prepends `window.location.origin` for copyable links.

## Storefront + Pay-in-3 (direct-to-buyer)
- Separate from group-ordering. Home `/` = storefront (`pages/home.tsx`, currency **eur** — SCR usually unsupported by Stripe); the old group form moved to `/group-order` (`pages/group-order.tsx`, still SCR). Tables: `store_order`/`store_installment`/`store_voucher` in `lib/db/src/schema/storefront.ts`.
- Catalog/pricing live **server-side** in `storeCatalog.ts` — price is never trusted from the client (`priceFor` recomputes from catalog/gift).
- Instalment engine: charge instalment 1 today with `setup_future_usage: "off_session"` to save the card; daily cron `POST /api/storefront/jobs/charge-instalments` (Bearer SESSION_SECRET) charges the rest off-session. Finalisation is via the `payment_intent.succeeded` webhook OR the confirm endpoint retrieving the PI — `processPaidIntent` is the single idempotent sink keyed on `pi.metadata.orderId/instalmentNo`.
- **Cron duplicate-charge guard (enforced after review):** before creating each off-session PI, atomically claim the row with a conditional `UPDATE … SET status='charging' WHERE id=? AND status IN ('scheduled','failed')` and skip if 0 rows returned. Without this, a delayed/failed webhook leaves the row `scheduled` and the next cron run re-charges (Stripe idempotency keys only retain ~24h). Store `paymentIntentId` on the instalment after create.
- Graceful degrade: `getStorefrontConfig` returns `publishable_key:""` + `payments_enabled:false` when Stripe isn't connected; frontend shows "Preview mode" banner and disables checkout. Stripe pkgs `@stripe/stripe-js` + `@stripe/react-stripe-js`; Payment Element uses `confirmPayment({ redirect: "if_required" })` then calls the confirm hook.

## Client Account Dashboard (Clerk)
- Auth is **Replit-managed Clerk**, web side is **cookie-based** — do NOT add `getToken`/Bearer/`setAuthTokenGetter` on the web client. Server uses `@clerk/express` `clerkMiddleware`; the Clerk proxy middleware must run BEFORE body parsers (alongside the Stripe webhook raw route).
- `requireAuth` resolves the user's **verified primary email** (`clerkClient.users.getUser`) and exposes it lowercased; routes 401 unauth / 403 if no verified email. Protected routes: `GET /api/dashboard` and `POST /api/dashboard/group-orders/:orderId/lines/:lineId/resend` (owner-scoped reminder — order matched by id AND lowercased organiser_email, so an organiser can only re-surface links for orders they own; distinct from the public token-based `/api/group-orders/:statusToken/.../resend`).
- **Scoping rule:** every dashboard record is matched strictly to that verified email, case-insensitively via `eq(sql\`lower(col)\`, normalized)`. Aggregates across both flows — storefront (`buyer_email`) and group (`payer_email` for paid lines + `organiser_email`). Organiser-owned group orders are surfaced in full as `organised_orders` (any status, incl. zero payments) with per-line status/amount/pay_link and master voucher once `complete`.
- **Reminders send no email** — `resendLine`/`resendLineForOrganiser` just return the pay link; the "Reminder sent" toast is cosmetic. There is no email infrastructure in this app.
- Receipt URLs captured at webhook time (`receiptUrl` on voucher_line/store_installment, `firstReceiptUrl` on store_order); dashboard does a best-effort on-demand Stripe backfill when a paid record is missing one (never throws into the request path).
- Home `/` stays **public** (it's the storefront) — intentionally diverges from the clerk-auth skill's auth-redirect-home pattern. Existing token-based pay/group pages are untouched by auth.

## Design source of truth
- The static `seaboards-jubilee` reference site (`attached_assets/seaboards_jubilee_extract/public/*.html`) is the authoritative design+content. Navy `#1F3A5F` / gold `#B8860B` / cream `#F8F6F1`, classic serif (Iowan/Palatino/Georgia) + system sans. Editorial masthead (no hero image). Theme lives in `index.css`.
- App has a `/terms` route (`pages/terms.tsx`) reproducing the reference 9-section T&C verbatim with hierarchical clause numbering (`{section}.{n}`). When offer rates/dates/perks change, update BOTH the home offer block and Terms.

## Staff Admin Dashboard
- Admin area (`/admin`, `/admin/orders`, `/admin/vouchers`) is gated **solely by Clerk identity + a `STAFF_EMAILS` allow-list** — the browser never holds the scheduler's `SESSION_SECRET`. `requireStaff` (Clerk verified primary email must be in `STAFF_EMAILS`) backs every `/api/admin/*` route; the daily charge job stays on its own `SESSION_SECRET` Bearer auth (unchanged).
- **`STAFF_EMAILS` must be set** (comma/space separated) or *all* admin endpoints return 403 by design (secure default). Without it the admin UI is unreachable even for signed-in users.
- Frontend guard: routes wrap in signed-in `Show` then `AdminShell` calls `GET /admin/me`; non-staff (403) redirect to `/`. Web stays cookie-based (no Bearer), same as the dashboard.
- Manual voucher issuance required making `store_voucher.order_id` **nullable** (standalone vouchers have no order).
- `retryInstalment` no-double-charge rule (enforced after review): idempotency key is `...-retry{attempts}`, but **`attempts` (and thus the key) may only advance when Stripe proves no money moved** — i.e. a *definitive* failure (`StripeCardError`/`StripeInvalidRequestError`/`authentication_required`). On an **indeterminate** failure (timeout, `StripeConnectionError`, generic API error) leave `attempts` unchanged so the next retry replays the SAME key and Stripe returns the original PaymentIntent instead of charging twice. Also retrieve any stored `paymentIntentId` before charging and short-circuit if it is already succeeded/processing. The `payment_intent.succeeded` webhook is the backstop. **Why:** advancing the key on every failure (the original bug) let a retry after a timed-out-but-successful charge create a second charge.
- Cancel = flip order to `cancelled` + set remaining `scheduled/failed/needs_action/charging` instalments to `cancelled`; the charge job only selects `['scheduled','failed']`, so cancelled rows are never re-charged. **No refunds** anywhere in admin.
- Redeem is atomic: `UPDATE … SET status='redeemed' WHERE code=? AND status='active' RETURNING` (then a post-check reverts if the matched row was expired) — two concurrent redeems can't both win.

## "Pay in N" instalments are NOT a Stripe subscription
First payment saves the card to a Stripe Customer (`setup_future_usage: off_session`) and charges 1/N. Instalments 2..N live in the app DB (`storeInstallments`, due dates `INTERVAL_DAYS` apart), NOT in Stripe — there is no Stripe Subscription/Schedule object. Each future instalment becomes its own off-session PaymentIntent when charged.
**Critical:** the charge job (`chargeDueInstalments`) has NO built-in scheduler. It only runs when something POSTs to `/api/storefront/jobs/charge-instalments` (Bearer = `SESSION_SECRET`). Without an external daily trigger, instalments 2..N are NEVER collected.
**Trigger:** a Replit Scheduled Deployment runs `pnpm --filter @workspace/scripts run charge-instalments` (script `scripts/src/charge-instalments.ts`), which POSTs to that endpoint using `STORE_BASE_URL` (prod URL, shared env) + `SESSION_SECRET`. Job is idempotent (atomic row claim + Stripe idempotency), so daily retries are safe.
