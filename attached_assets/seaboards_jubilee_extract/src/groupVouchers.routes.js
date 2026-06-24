// =====================================================================
//  src/groupVouchers.routes.js
//  Two routers:
//   - webhookRouter : Stripe webhook (RAW body) -> mount before express.json
//   - apiRouter     : JSON data + actions under /api
//  Pretty public routes (/pay/:token, /group/:token) live in server.js.
// =====================================================================
const express = require('express');
const Stripe = require('stripe');
const svc = require('./groupVouchers.service');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---- Webhook (raw body) ----------------------------------------------------
const webhookRouter = express.Router();
webhookRouter.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
      if (event.type === 'checkout.session.completed') {
        await svc.handleSessionCompleted(event.data.object);
      }
      res.json({ received: true });
    } catch (e) {
      console.error('Webhook handler error:', e.message);
      res.status(500).json({ error: 'handler_failed' });
    }
  }
);

// ---- API data + actions (JSON) --------------------------------------------
const apiRouter = express.Router();
apiRouter.use(express.json());

apiRouter.post('/group-orders', async (req, res) => {
  try { res.status(201).json(await svc.createGroupOrder(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

apiRouter.get('/group-orders/:statusToken', async (req, res) => {
  const view = await svc.getOrganiserView(req.params.statusToken);
  if (!view) return res.status(404).json({ error: 'not_found' });
  res.json(view);
});

apiRouter.post('/group-orders/:statusToken/lines/:lineId/resend', async (req, res) => {
  const out = await svc.resendLine(req.params.statusToken, req.params.lineId);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

// Read-only status for the payment "done" page to poll for the voucher code.
apiRouter.get('/pay/:payToken/status', async (req, res) => {
  const out = await svc.getLineStatusByPayToken(req.params.payToken);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

// Manual sweep trigger — protect or remove in production.
apiRouter.post('/group-orders/admin/sweep', async (_req, res) => {
  res.json(await svc.sweepExpired());
});

module.exports = { webhookRouter, apiRouter };
