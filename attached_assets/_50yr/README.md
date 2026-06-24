# Group Vouchers — Seaboards Golden Jubilee

Lets a group organiser buy multiple Jubilee vouchers in one order, where **each
person gets their own payment link**. Two modes:

- **independent** (default, safe): each person's link buys their **own** voucher.
  If one person never pays, only *their* line fails — everyone else's voucher
  still issues.
- **split** (opt-in, all-or-nothing): several people chip in on **one** room.
  The shared voucher issues **only when every share is paid**. If the order
  hits its deadline part-paid, the paid shares convert to **Ezzy Group Credit**
  (matches Clause 5 of the offer T&Cs).

## Files
```
db/schema.sql                  -- Postgres tables (run once)
src/groupVouchers.service.js   -- rates, order creation, Stripe, paid-handling, sweep
src/groupVouchers.routes.js    -- Express routes + Stripe webhook
client/OrganiserStatus.jsx     -- organiser status page (React)
```

## Environment variables
```
DATABASE_URL=postgres://...
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=https://your-app.example      # used to build pay links + redirects
VOUCHER_CURRENCY=SCR                        # see currency note below
VITE_API_BASE=                              # front-end: API origin (blank if same origin)
```

## Wiring order (critical)
The Stripe webhook needs the **raw** request body, so mount it **before** any
global `express.json()`:

```js
const express = require('express');
const { webhookRouter, apiRouter } = require('./src/groupVouchers.routes');

const app = express();

// 1) webhook FIRST (raw body inside the router)
app.use('/api', webhookRouter);

// 2) everything else (apiRouter applies express.json itself)
app.use('/api', apiRouter);

app.listen(process.env.PORT || 3000);
```

Endpoints exposed:
```
POST /api/group-orders                                  create order, returns pay links
GET  /api/group-orders/:statusToken                     organiser status data
POST /api/group-orders/:statusToken/lines/:lineId/resend re-surface a payer link
GET  /api/pay/:payToken                                  mint Stripe session + redirect
POST /api/webhooks/stripe                                Stripe events
POST /api/group-orders/admin/sweep                       expire overdue orders (protect!)
```

## Create an order (independent mode)
```bash
curl -X POST $APP_BASE_URL/api/group-orders -H 'Content-Type: application/json' -d '{
  "mode": "independent",
  "organiser_name": "Marie",
  "organiser_email": "marie@example.com",
  "due_by": "2026-09-30T23:59:59Z",
  "lines": [
    { "apartment_type": "one_bedroom", "nights": 2, "payer_name": "Marie",  "payer_email": "marie@example.com" },
    { "apartment_type": "one_bedroom", "nights": 2, "payer_name": "Jean",   "payer_email": "jean@example.com" },
    { "apartment_type": "two_bedroom", "nights": 3, "payer_name": "Sophie", "payer_email": "sophie@example.com" }
  ]
}'
```
Response includes `organiserUrl` and a `pay_link` per person.

## Create an order (split one room equally)
```bash
curl -X POST $APP_BASE_URL/api/group-orders -H 'Content-Type: application/json' -d '{
  "mode": "split",
  "organiser_name": "Marie",
  "organiser_email": "marie@example.com",
  "due_by": "2026-09-30T23:59:59Z",
  "split": { "apartment_type": "two_bedroom", "nights": 3 },
  "lines": [
    { "payer_name": "Marie",  "payer_email": "marie@example.com" },
    { "payer_name": "Jean",   "payer_email": "jean@example.com" },
    { "payer_name": "Sophie", "payer_email": "sophie@example.com" }
  ]
}'
```
Room total (3750 × 3 = SCR 11,250) is split equally; pass `share_minor` per line
to split unequally (shares must sum to the room total).

## Expiry sweep (Replit Scheduled Deployment / cron)
```js
require('./src/groupVouchers.service').sweepExpired().then(console.log);
```

## Currency note
`price_data.unit_amount` is in **minor units** (×100 for SCR). Confirm your
Stripe account can **process** SCR; many Seychelles accounts settle in USD/EUR.
If so, set `VOUCHER_CURRENCY` to the processing currency and convert the rate
table, or price the voucher in that currency. Amounts are always computed
**server-side** from the rate table — client-supplied amounts are ignored.

## Stripe setup
1. Dashboard → Developers → Webhooks → add endpoint `…/api/webhooks/stripe`,
   event `checkout.session.completed`; copy the signing secret to
   `STRIPE_WEBHOOK_SECRET`.
2. The webhook is the single source of truth for "paid" — never mark a line paid
   from the browser success redirect.
