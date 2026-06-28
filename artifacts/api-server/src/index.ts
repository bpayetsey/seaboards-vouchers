import { runMigrations } from "stripe-replit-sync";
import app from "./app";
import { logger } from "./lib/logger";
import { getStripeSync } from "./lib/stripeClient";
import { dispatchDueCampaigns } from "./lib/whatsappCampaigns";
import { releaseStaleReservedCredit } from "./lib/storefront";
import { sendDueVisitReminders } from "./lib/dayPass";

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

/**
 * Recurring WhatsApp campaign dispatcher.
 *
 * Campaign sends run as a background loop detached from the HTTP request that
 * triggered them, and the daily cap means a campaign needs to be re-poked over
 * several days to drain. This timer is that poke: every minute it resumes any
 * campaign still in `sending` and starts any `scheduled` campaign whose time
 * has arrived (see dispatchDueCampaigns). It self-heals after a restart and
 * makes mass sends survive without an external scheduler.
 *
 * Requires an always-on deployment (Reserved VM). On autoscale the instance is
 * suspended between requests, so this timer does not fire reliably and sends
 * stall — which is why the deployment target is "vm".
 *
 * Concurrency is safe: a per-process guard avoids piling up overlapping ticks,
 * and dispatchCampaign additionally holds a Postgres advisory lock per campaign.
 */
const DISPATCH_INTERVAL_MS = 60_000;
let dispatchInFlight = false;

async function dispatchTick(): Promise<void> {
  if (dispatchInFlight) return;
  dispatchInFlight = true;
  try {
    await dispatchDueCampaigns();
  } catch (err) {
    logger.error({ err }, "Scheduled WhatsApp dispatch failed");
  } finally {
    dispatchInFlight = false;
  }
}

const dispatchTimer = setInterval(() => void dispatchTick(), DISPATCH_INTERVAL_MS);
dispatchTimer.unref();

// Kick once shortly after boot so a stuck campaign resumes promptly instead of
// waiting a full interval.
void dispatchTick();

/**
 * Guaranteed release of account credit reserved by abandoned checkouts. Credit
 * is reserved (decremented) when an order is created; if the buyer never pays,
 * this sweep returns it after a grace window so it is never stranded. Same
 * always-on (VM) requirement and per-process guard rationale as the dispatcher.
 */
const CREDIT_SWEEP_INTERVAL_MS = 15 * 60_000;
let creditSweepInFlight = false;

async function creditSweepTick(): Promise<void> {
  if (creditSweepInFlight) return;
  creditSweepInFlight = true;
  try {
    const released = await releaseStaleReservedCredit();
    if (released > 0) {
      logger.info({ released }, "Released stale reserved checkout credit");
    }
  } catch (err) {
    logger.error({ err }, "Stale reserved-credit sweep failed");
  } finally {
    creditSweepInFlight = false;
  }
}

const creditSweepTimer = setInterval(
  () => void creditSweepTick(),
  CREDIT_SWEEP_INTERVAL_MS,
);
creditSweepTimer.unref();
void creditSweepTick();

/**
 * Pre-visit reminder sweep. Day-pass guests whose dated visit is tomorrow get a
 * one-time reminder email (date, pax, voucher code, manage-booking link). The
 * send is idempotent per booking/date via a claim column, so running hourly is
 * safe and self-heals after restarts. Same always-on (VM) requirement and
 * per-process guard rationale as the dispatcher.
 */
const REMINDER_SWEEP_INTERVAL_MS = 60 * 60_000;
let reminderSweepInFlight = false;

async function reminderSweepTick(): Promise<void> {
  if (reminderSweepInFlight) return;
  reminderSweepInFlight = true;
  try {
    const sent = await sendDueVisitReminders();
    if (sent > 0) {
      logger.info({ sent }, "Sent day-pass visit reminders");
    }
  } catch (err) {
    logger.error({ err }, "Day-pass visit reminder sweep failed");
  } finally {
    reminderSweepInFlight = false;
  }
}

const reminderSweepTimer = setInterval(
  () => void reminderSweepTick(),
  REMINDER_SWEEP_INTERVAL_MS,
);
reminderSweepTimer.unref();
void reminderSweepTick();
