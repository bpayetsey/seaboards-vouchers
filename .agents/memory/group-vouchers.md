---
name: Group Vouchers app
description: Seaboards Golden Jubilee group-voucher app — modes, pricing, Stripe usage, and expiry/sweep rules.
---

# Group Vouchers (Seaboards Golden Jubilee)

Resort group-voucher offer for Seychelles, currency SCR. Lives in `artifacts/group-vouchers` (web, root path) + `artifacts/api-server` (Express) + `lib/db` schema (`groupOrders`, `voucherLines`).

## Two order modes
- **independent** — each payer buys their own voucher; each paid line gets its own `voucherCode`. Order becomes `complete` when all lines paid.
- **split** — all-or-nothing shared voucher. Shares are equal-split (remainder on first line) OR explicit `share_minor` that must each be positive and sum to room total. Order `complete` (with a single `splitVoucherCode`) only when every line is paid.

## Pricing
Rates major units: `one_bedroom=2300`, `two_bedroom=3750` per night. `MINOR_PER_MAJOR=100`. Amount stored in minor units. `amount = rate * nights * 100`.

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

## Design source of truth
- The static `seaboards-jubilee` reference site (`attached_assets/seaboards_jubilee_extract/public/*.html`) is the authoritative design+content. Navy `#1F3A5F` / gold `#B8860B` / cream `#F8F6F1`, classic serif (Iowan/Palatino/Georgia) + system sans. Editorial masthead (no hero image). Theme lives in `index.css`.
- App has a `/terms` route (`pages/terms.tsx`) reproducing the reference 9-section T&C verbatim with hierarchical clause numbering (`{section}.{n}`). When offer rates/dates/perks change, update BOTH the home offer block and Terms.
