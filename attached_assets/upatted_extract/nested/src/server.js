/**
 * The Seaboards — 50th Independence Voucher Campaign
 * Single Express app: serves the storefront AND the Stripe payment-plan API.
 *
 * Payment plans = custom instalments (BNPL like Klarna/Afterpay isn't available
 * to Seychelles merchants). We charge instalment 1 today and save the card, then
 * a daily job charges the rest off-session.
 */

import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { CATALOG, GIFT, SETTINGS, SYMBOLS, priceFor, nameFor } from "./catalog.js";
import { sendVoucherEmail, sendActionRequiredEmail, sendPaymentFailedEmail } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");
const prisma = new PrismaClient();
const app = express();

const CUR = SETTINGS.currency;
const toMinor = (major) => Math.round(Number(major) * 100); // eur/usd/scr/gbp are 2-decimal
const newCode = () =>
  "SB50-" + Array.from({ length: 3 }, () => crypto.randomBytes(2).toString("hex").toUpperCase()).join("-");

/* ── Stripe webhook needs the RAW body → mount BEFORE express.json() ── */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature failed: ${err.message}`);
  }
  if (event.type === "payment_intent.succeeded") {
    try { await processPaidIntent(event.data.object); } catch (e) { console.error(e); }
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

/* ── Public config for the storefront (publishable key is safe to expose) ── */
app.get("/api/config", (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    currency: CUR,
    symbol: SYMBOLS[CUR] || "",
    instalments: SETTINGS.instalments,
    intervalDays: SETTINGS.intervalDays,
    catalog: CATALOG,
    gift: GIFT,
  });
});

/* ── Create order → PaymentIntent #1 (or full payment) ── */
app.post("/api/orders", async (req, res) => {
  try {
    const { productId, type = "package", amount, plan, name, email } = req.body;
    if (!name?.trim() || !email?.includes("@"))
      return res.status(400).json({ error: "Enter your name and a valid email." });

    // price comes from the catalog, never from the client
    const total = priceFor({ productId, type, amount });
    if (total === null) return res.status(400).json({ error: "Invalid voucher selection." });
    const productName = nameFor({ productId, type });

    const payInN = String(plan) === "3" || Number(plan) === SETTINGS.instalments;
    const installments = payInN ? SETTINGS.instalments : 1;
    const per = Math.round((total / installments) * 100) / 100;
    const firstAmount = installments === 1 ? total : per;

    const customer = await stripe.customers.create({ email, name, metadata: { campaign: "sb50" } });

    const order = await prisma.order.create({
      data: {
        productId, productName, type, buyerName: name, buyerEmail: email,
        currency: CUR, totalMinor: toMinor(total), installments,
        stripeCustomerId: customer.id, status: "pending",
      },
    });

    const pi = await stripe.paymentIntents.create({
      amount: toMinor(firstAmount),
      currency: CUR,
      customer: customer.id,
      payment_method_types: ["card"],                 // card-only: needed to save for off-session
      setup_future_usage: payInN ? "off_session" : undefined,
      metadata: { orderId: order.id, instalmentNo: "1", instalments: String(installments) },
    }, { idempotencyKey: `order-${order.id}-i1` });

    await prisma.order.update({ where: { id: order.id }, data: { firstPaymentIntentId: pi.id } });
    res.json({ orderId: order.id, clientSecret: pi.client_secret });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not start checkout. Check the Stripe secret key." });
  }
});

/* ── Finalize after the browser confirms (webhook fallback / source of truth) ── */
app.post("/api/orders/:id/confirm", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.firstPaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(order.firstPaymentIntentId);
      if (pi.status === "succeeded") await processPaidIntent(pi);
    }
    const voucher = await prisma.voucher.findUnique({ where: { orderId: order.id } });
    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    res.json({
      status: fresh.status,
      paidInstalments: fresh.paidInstalments,
      installments: fresh.installments,
      voucher: voucher ? { code: voucher.code, status: voucher.status } : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not confirm the order." });
  }
});

/* ── Shared, idempotent: a PaymentIntent (any instalment) has succeeded ── */
async function processPaidIntent(pi) {
  const orderId = pi.metadata?.orderId;
  if (!orderId) return;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { schedule: true } });
  if (!order) return;
  const instalmentNo = Number(pi.metadata.instalmentNo || 1);

  if (instalmentNo === 1) {
    if (order.paidInstalments < 1) {
      const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
      if (pm) {
        await stripe.customers.update(order.stripeCustomerId,
          { invoice_settings: { default_payment_method: pm } }).catch(() => {});
      }
      await prisma.order.update({
        where: { id: order.id }, data: { stripePaymentMethodId: pm || null, paidInstalments: 1 },
      });
      // build instalments 2..N once
      if (order.installments > 1 && order.schedule.length === 0) {
        const per = Math.round(order.totalMinor / order.installments);
        const rows = [];
        for (let i = 2; i <= order.installments; i++) {
          const last = i === order.installments;
          const amountMinor = last ? order.totalMinor - per * (order.installments - 1) : per;
          const dueAt = new Date(); dueAt.setDate(dueAt.getDate() + (i - 1) * SETTINGS.intervalDays);
          rows.push({ orderId: order.id, number: i, amountMinor, dueAt, status: "scheduled" });
        }
        await prisma.installment.createMany({ data: rows });
      }
    }
  } else if (order.paidInstalments < instalmentNo) {
    await prisma.installment.updateMany({
      where: { orderId: order.id, number: instalmentNo, status: { not: "paid" } },
      data: { status: "paid", paidAt: new Date() },
    });
    await prisma.order.update({ where: { id: order.id }, data: { paidInstalments: instalmentNo } });
  }

  const fullyPaid = instalmentNo >= order.installments;
  if (fullyPaid && order.status !== "paid")
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } });

  // issue / activate the voucher per policy
  const shouldIssue =
    (SETTINGS.issueOn === "deposit" && instalmentNo === 1) ||
    (SETTINGS.issueOn === "paid" && fullyPaid);
  if (!shouldIssue) return;

  const existing = await prisma.voucher.findUnique({ where: { orderId: order.id } });
  const voucher = existing
    ? await prisma.voucher.update({ where: { id: existing.id }, data: { status: fullyPaid ? "active" : "pending" } })
    : await prisma.voucher.create({
        data: {
          orderId: order.id, code: newCode(), valueMinor: order.totalMinor, currency: order.currency,
          status: fullyPaid ? "active" : "pending", expiresAt: new Date(Date.now() + 365 * 864e5),
        },
      });
  await sendVoucherEmail(order, voucher, fullyPaid);
}

/* ── Daily job: charge due instalments off-session ── */
export async function chargeDueInstalments() {
  const due = await prisma.installment.findMany({
    where: { status: { in: ["scheduled", "failed"] }, dueAt: { lte: new Date() } },
    include: { order: true },
  });
  for (const inst of due) {
    const { order } = inst;
    if (!order.stripePaymentMethodId) continue;
    try {
      await stripe.paymentIntents.create({
        amount: inst.amountMinor, currency: order.currency,
        customer: order.stripeCustomerId, payment_method: order.stripePaymentMethodId,
        off_session: true, confirm: true,
        metadata: { orderId: order.id, instalmentNo: String(inst.number) },
      }, { idempotencyKey: `order-${order.id}-i${inst.number}` });
      // success is finalised by the webhook (or the next confirm)
    } catch (err) {
      if (err.code === "authentication_required") {
        await prisma.installment.update({ where: { id: inst.id }, data: { status: "needs_action" } });
        await sendActionRequiredEmail(order, inst);
      } else {
        await prisma.installment.update({
          where: { id: inst.id },
          data: { status: "failed", lastError: err.message, attempts: { increment: 1 } },
        });
        await sendPaymentFailedEmail(order, inst);
      }
    }
  }
  return { processed: due.length };
}

// Cron endpoint (protect with a shared secret on Replit Scheduled Deployments)
app.post("/api/jobs/charge-instalments", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) return res.sendStatus(401);
  res.json(await chargeDueInstalments());
});

// Tiny admin peek (orders + instalment status). Add real auth before exposing.
app.get("/api/admin/orders", async (_req, res) => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" }, take: 100,
    include: { schedule: { orderBy: { number: "asc" } }, voucher: true },
  });
  res.json(orders);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Seaboards vouchers running on :${port}  (currency: ${CUR})`);
  if (process.env.ENABLE_INPROCESS_CRON === "true") {
    const run = () => chargeDueInstalments().then(r => r.processed && console.log("cron:", r)).catch(console.error);
    run();
    setInterval(run, 6 * 60 * 60 * 1000); // every 6h while the repl is awake
  }
});
