import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Fetches Stripe credentials from the Replit connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time.
 */
export async function getStripeCredentials(): Promise<{
  secretKey: string;
  webhookSecret?: string;
  publishableKey?: string;
}> {
  // Prefer explicit secrets when provided (e.g. live keys set in the Publish
  // pane / deployment secrets). This lets production use a different Stripe
  // account than the development connection without touching the connector.
  if (process.env.STRIPE_SECRET_KEY) {
    return {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || undefined,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    items?: Array<{
      settings?: {
        secret?: string;
        publishable?: string;
        webhook_secret?: string;
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret) {
    throw new Error(
      "Stripe integration not connected or missing secret key. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }

  return {
    secretKey: settings.secret,
    webhookSecret: settings.webhook_secret,
    publishableKey: settings.publishable,
  };
}

/**
 * Best-effort fetch of the Stripe publishable key for the browser-side Payment
 * Element. Returns an empty string when Stripe is not connected yet so the
 * storefront can degrade gracefully instead of throwing.
 */
export async function getStripePublishableKey(): Promise<string> {
  if (process.env.STRIPE_PUBLISHABLE_KEY) {
    return process.env.STRIPE_PUBLISHABLE_KEY;
  }
  try {
    const { publishableKey } = await getStripeCredentials();
    return publishableKey ?? "";
  } catch {
    return "";
  }
}

/**
 * Returns a fresh authenticated Stripe client.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Best-effort fetch of the hosted Stripe receipt URL for a PaymentIntent.
 * Expands the latest charge to read its `receipt_url`. Returns null when the
 * receipt cannot be resolved (e.g. payment not captured yet) instead of
 * throwing, so callers can degrade gracefully.
 */
export async function fetchReceiptUrlForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = pi.latest_charge;
    if (charge && typeof charge !== "string") {
      return charge.receipt_url ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Best-effort fetch of the hosted Stripe receipt URL for a Checkout Session
 * (used by the group-voucher flow, which pays via hosted Checkout).
 */
export async function fetchReceiptUrlForSession(
  stripe: Stripe,
  sessionId: string,
): Promise<string | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    });
    const pi = session.payment_intent;
    if (pi && typeof pi !== "string") {
      const charge = pi.latest_charge;
      if (charge && typeof charge !== "string") {
        return charge.receipt_url ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a fresh StripeSync instance for webhook processing and data sync.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}
