import type Stripe from "stripe";
import { getStripeSync } from "./stripeClient";
import { handleSessionCompleted } from "./groupVouchers";
import { processPaidIntent } from "./storefront";

export async function processWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "Ensure the webhook route is registered BEFORE express.json().",
    );
  }

  // Verify the signature and sync the Stripe object into the local `stripe`
  // schema. With managed webhooks, stripe-replit-sync resolves the signing
  // secret it stored when the webhook was created -- the connector does not
  // expose a webhook secret directly.
  const sync = await getStripeSync();
  await sync.processWebhook(payload, signature);

  // The payload is verified at this point, so it is safe to parse it for our
  // own business-logic side effects (group vouchers + storefront instalments).
  const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;

  // Webhook is the durable retrier: pass propagateEmailError so a failed voucher
  // email surfaces as a non-2xx response and Stripe retries the event (with
  // backoff for up to ~3 days), guaranteeing eventual delivery. Buyer/admin
  // request paths intentionally do not propagate, so a transient email outage
  // never breaks their flow — the webhook covers the retry.
  if (event.type === "checkout.session.completed") {
    await handleSessionCompleted(event.data.object, { propagateEmailError: true });
  } else if (event.type === "payment_intent.succeeded") {
    await processPaidIntent(event.data.object, { propagateEmailError: true });
  }
}
