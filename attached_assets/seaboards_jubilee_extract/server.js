// =====================================================================
//  server.js — Seaboards Golden Jubilee site (single runnable app)
//  Run: npm start   (after npm install + npm run init-db)
// =====================================================================
const path = require('path');
const express = require('express');
const svc = require('./src/groupVouchers.service');
const { webhookRouter, apiRouter } = require('./src/groupVouchers.routes');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// 1) Stripe webhook FIRST — needs the raw body, before any JSON parser.
app.use('/api', webhookRouter);

// 2) JSON API (router applies express.json itself).
app.use('/api', apiRouter);

// 3) Pretty public routes -----------------------------------------------------

// Per-person payment link: mint a fresh Stripe session and redirect to it.
app.get('/pay/:payToken', async (req, res) => {
  try {
    const out = await svc.startCheckout(req.params.payToken);
    if (out.url) return res.redirect(303, out.url);
    const map = {
      not_found: ['Payment link not found.', 404],
      already_paid: ['This share is already paid — thank you!', 409],
      closed: ['This offer is closed or the payment window has passed.', 409],
    };
    const [msg, code] = map[out.error] || ['Unable to start checkout.', 400];
    res.status(code).send(pageShell('Payment', `<p>${msg}</p>`));
  } catch (e) {
    res.status(500).send(pageShell('Payment', `<p>Something went wrong. Please try again.</p>`));
  }
});

// Payment success page — polls for the issued voucher code.
app.get('/pay/:payToken/done', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'done.html'));
});

// Organiser status page (data loaded client-side from /api/group-orders/:token).
app.get('/group/:statusToken', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'group.html'));
});

// 4) Static assets + landing/terms.
app.use(express.static(PUBLIC));
app.get('/terms', (_req, res) => res.sendFile(path.join(PUBLIC, 'terms.html')));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

function pageShell(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
  <body style="font-family:system-ui;max-width:560px;margin:80px auto;color:#2A2E35;text-align:center">
  <h2 style="color:#1F3A5F">The Seaboards · Golden Jubilee</h2>${body}
  <p><a href="/" style="color:#B8860B">Return to the offer</a></p></body>`;
}

app.listen(PORT, () => console.log(`Seaboards Jubilee site running on :${PORT}`));
