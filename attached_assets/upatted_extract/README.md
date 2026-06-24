# The Seaboards — 50th Independence Voucher Site (Replit)

One Express app that **serves the storefront and the Stripe payment-plan API**.
SQLite means no database to set up — press **Run**.

```
.replit                Run config (green Run button)
package.json           Scripts + deps
prisma/schema.prisma   SQLite schema (Order, Installment, Voucher, …)
src/server.js          API + static hosting + instalment engine
src/catalog.js         Vouchers & prices (single source of truth)
src/email.js           Email stubs (wire your provider later)
public/index.html      Storefront
public/app.js          Storefront logic + Stripe Payment Element
```

## 1. Import into Replit

- **Create Repl → Import from GitHub**, or
- **Create Repl (Node.js) → ⋮ → Upload folder / Upload zip** and drop these files in.

## 2. Add your keys (Secrets 🔒, not a file)

Open the **Secrets** tab and add:

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `DATABASE_URL` | `file:./dev.db` |
| `CURRENCY` | `eur` (see note below) |
| `INSTALMENTS` | `3` |
| `INTERVAL_DAYS` | `30` |
| `ISSUE_ON` | `paid` |
| `ENABLE_INPROCESS_CRON` | `true` |
| `CRON_SECRET` | any random string |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` *(optional in dev)* |

> Get the keys from the **Stripe Dashboard → Developers → API keys** (toggle **Test mode** on first).

## 3. Press Run

On first Run, Replit installs packages, runs `prisma generate`, then `prisma db push`
creates the SQLite tables and starts the server. Open the webview — the campaign loads.

## 4. Test a purchase

Use Stripe's test cards in the Payment Element:

- **Pay in full / success:** `4242 4242 4242 4242`, any future expiry, any CVC.
- **Pay in 3:** same card. You're charged 1/3 now; the card is saved for the rest.
- **Needs authentication (3-D Secure):** `4000 0027 6000 3184`.
- **Off-session retry that needs the customer:** `4000 0025 0000 3155`.

After paying, the success panel shows the voucher code (when `ISSUE_ON` lets it activate).
You'll also see the email stub fire in the **Console**.

## ⚠️ Currency — confirm before going live

Stripe settles in the currencies your **account country** allows; **SCR is usually not
supported**, so the default is `eur`. Set `CURRENCY` to whatever your existing Stripe
account (the EzzyPoint one) settles in — that single Secret drives both the storefront
and the charges.

## How "Pay in 3" works (the important part)

There's no Klarna/Afterpay here — BNPL isn't available to Seychelles merchants. Instead:

1. Instalment 1 is charged today and the card is **saved** (`setup_future_usage:'off_session'`).
2. `src/server.js → processPaidIntent()` builds the schedule for instalments 2–3.
3. `chargeDueInstalments()` charges the rest **off-session** when due. While the repl is
   awake, the in-process timer runs it every 6h; the proper way is a **Replit Scheduled
   Deployment** hitting `POST /api/jobs/charge-instalments` daily with header
   `x-cron-secret: <CRON_SECRET>`.
4. Cards that need re-authentication or fail get their own status + email path.

The voucher activates per `ISSUE_ON`: `paid` (only when fully paid — safer) or
`deposit` (after instalment 1 — better for gifting, carries default risk).

## Webhooks (recommended for production)

The browser-side **confirm** step finalises orders so the demo works without webhooks.
For production, add a Stripe webhook to `https://<your-repl-url>/api/stripe/webhook`
for `payment_intent.succeeded`, and put the signing secret in `STRIPE_WEBHOOK_SECRET`.
This is what reliably records off-session instalment charges.

## Change the offer

Edit `src/catalog.js` — package names, prices, the gift amounts. Prices are validated
server-side from this file, so the client can't tamper with them.

## A peek at orders

`GET /api/admin/orders` returns recent orders with instalment status and the voucher.
Add real auth before exposing it publicly.

## Going multi-tenant later

The schema already has a `Business` table, so the same app can sell vouchers for any
business. Seaboards is tenant #1 — wire a `slug` per business and filter the catalog by it.
