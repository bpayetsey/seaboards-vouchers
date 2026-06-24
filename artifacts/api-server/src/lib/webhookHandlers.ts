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

  if (event.type === "checkout.session.completed") {
    await handleSessionCompleted(event.data.object);
  } else if (event.type === "payment_intent.succeeded") {
    await processPaidIntent(event.data.object);
  }
}
