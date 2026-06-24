import { getStripeCredentials, getUncachableStripeClient } from "./stripeClient";
import { handleSessionCompleted } from "./groupVouchers";

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

  const { webhookSecret } = await getStripeCredentials();
  if (!webhookSecret) {
    throw new Error("Stripe webhook secret is not configured");
  }

  const stripe = await getUncachableStripeClient();
  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    webhookSecret,
  );

  if (event.type === "checkout.session.completed") {
    await handleSessionCompleted(event.data.object);
  }
}
