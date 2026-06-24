# The Seaboards — Golden Jubilee Site

A single runnable site for the Golden Jubilee offer: the public offer page, a
**group purchase flow where each person gets their own payment link**, the
organiser status page, the Stripe payment flow, and the Terms & Conditions —
all served by one Express app. No build step.

## What's inside
```
server.js                     Express app (webhook + API + pretty routes + static)
src/groupVouchers.service.js  rates, orders, Stripe sessions, paid-handling, sweep
src/groupVouchers.routes.js   API data/actions + Stripe webhook (raw body)
db/schema.sql                 Postgres tables
db/init.js                    applies schema.sql  (npm run init-db)
public/index.html             offer page + "Buy as a group" form
public/group.html             organiser status page
public/done.html              payment success page (shows the voucher code)
public/terms.html             Terms & Conditions
```

## Run on Replit (5 steps)
1. **Import** this folder into a new Replit (Node).
2. **Add a Postgres database** (Replit → Tools → Database, or any external Postgres).
3. **Secrets** (Tools → Secrets) — set the keys from `.env.example`:
   `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `APP_BASE_URL` (your repl's public URL), `VOUCHER_CURRENCY`.
4. In the Shell: `npm install` then `npm run init-db` (creates the tables).
5. Press **Run**. Open the web preview — the offer page loads at `/`.

## Stripe webhook
Stripe Dashboard → Developers → Webhooks → add endpoint:
`{APP_BASE_URL}/api/webhooks/stripe`, event `checkout.session.completed`.
Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. The webhook is the only
thing that marks a line **paid** and issues a voucher — never the browser.

## How the flow works
1. Organiser fills the group form on `/` → `POST /api/group-orders`.
2. Each person gets a stable link `…/pay/<token>`. Clicking it mints a fresh
   Stripe Checkout Session and redirects (so links never hit Stripe's 24h limit).
3. On payment, the webhook issues the voucher (independent) or, in split mode,
   the one shared voucher once **all** shares are paid.
4. Organiser watches `…/group/<status_token>` — paid/pending per person, with
   copy-link and resend buttons.
5. Overdue orders: run `npm run sweep` (wire to a Replit Scheduled Deployment).
   Split-mode paid shares convert to Ezzy Group Credit, per the offer T&Cs.

## Currency note
Amounts are computed server-side from the rate table (2,300 / 3,750) in minor
units (×100). Confirm Stripe can **process** SCR on your account — many
Seychelles accounts settle in USD/EUR. If so, set `VOUCHER_CURRENCY` and the
`RATES` table in `src/groupVouchers.service.js` to your processing currency.

## Optional next steps
- Wire the **resend** action to email/WhatsApp (360dialog) so laggards get nudged.
- Convert the front-end to your React/Vite app (a React `OrganiserStatus.jsx`
  is available) if you'd rather integrate than serve static pages.
