import { runMigrations } from "stripe-replit-sync";
import app from "./app";
import { logger } from "./lib/logger";
import { getStripeSync } from "./lib/stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Initialize the Stripe schema and register the managed webhook on startup.
 * Resilient: if Stripe is not yet connected, log a warning and keep serving so
 * the rest of the app boots normally.
 */
async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set; skipping Stripe initialization");
    return;
  }

  try {
    await runMigrations({ databaseUrl });

    const stripeSync = await getStripeSync();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domain) {
      const webhook = await stripeSync.findOrCreateManagedWebhook(
        `https://${domain}/api/stripe/webhook`,
      );
      logger.info(
        { webhook: webhook?.url ?? "configured" },
        "Stripe managed webhook ready",
      );
    } else {
      logger.warn("REPLIT_DOMAINS not set; skipping managed webhook setup");
    }
  } catch (err) {
    logger.warn(
      { err },
      "Stripe initialization skipped (integration not connected yet)",
    );
  }
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
