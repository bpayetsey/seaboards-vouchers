// =====================================================================
//  groupVouchers.routes.js
//  Mount in your Express app. IMPORTANT: the Stripe webhook needs the RAW
//  body, so register it BEFORE any global express.json() middleware.
//  See README for exact wiring order.
// =====================================================================
const express = require('express');
const Stripe = require('stripe');
const svc = require('./groupVouchers.service');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---- 1. Webhook router (raw body) -----------------------------------------
const webhookRouter = express.Router();
webhookRouter.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
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

// ---- 2. API + redirect router (JSON body) ---------------------------------
const apiRouter = express.Router();
apiRouter.use(express.json());

// Organiser creates a group order -> returns a pay link per person.
apiRouter.post('/group-orders', async (req, res) => {
  try {
    const out = await svc.createGroupOrder(req.body);
    res.status(201).json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Organiser status page data.
apiRouter.get('/group-orders/:statusToken', async (req, res) => {
  const view = await svc.getOrganiserView(req.params.statusToken);
  if (!view) return res.status(404).json({ error: 'not_found' });
  res.json(view);
});

// Resend (re-surface) a payer's link.
apiRouter.post('/group-orders/:statusToken/lines/:lineId/resend', async (req, res) => {
  const out = await svc.resendLine(req.params.statusToken, req.params.lineId);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

// Per-person stable link -> mint a fresh Stripe session and redirect.
apiRouter.get('/pay/:payToken', async (req, res) => {
  const out = await svc.startCheckout(req.params.payToken);
  if (out.url) return res.redirect(303, out.url);
  const messages = {
    not_found: 'This payment link was not found.',
    already_paid: 'This share has already been paid. Thank you!',
    closed: 'This offer is closed or the payment window has passed.',
  };
  res.status(out.error === 'not_found' ? 404 : 409)
     .send(messages[out.error] || 'Unable to start checkout.');
});

// Optional manual sweep trigger (protect/remove in production).
apiRouter.post('/group-orders/admin/sweep', async (_req, res) => {
  res.json(await svc.sweepExpired());
});

module.exports = { webhookRouter, apiRouter };
