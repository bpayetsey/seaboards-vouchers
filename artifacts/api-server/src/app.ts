import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { processWebhook } from "./lib/webhookHandlers";
import { verifyWebhookSignature } from "./lib/whatsappClient";
import { processWhatsappWebhook } from "./lib/whatsappCampaigns";

const app: Express = express();

// Trust the Replit edge proxy so that req.ip, req.protocol, and the
// x-forwarded-* headers resolve to the real client values rather than
// the internal proxy address. Without this, Express ignores the incoming
// x-forwarded-for chain and req.ip would return the proxy's loopback IP,
// which would cause all users to share the same apparent IP for any
// per-IP rate limiting or Clerk auth that inspects req.ip.
//
// The clerkProxyMiddleware reads req.headers["x-forwarded-for"] directly
// (bypassing Express trust-proxy entirely), but setting trust proxy is
// still required for correctness elsewhere in the stack (e.g. session
// security, protocol detection, any future per-IP middleware).
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk Frontend API proxy. Must be mounted BEFORE the body parsers since it
// streams raw bytes. No-op in development (Clerk hits its FAPI directly there).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook must receive the raw body and be registered BEFORE express.json().
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await processWebhook(req.body as Buffer, sig);
      return res.status(200).json({ received: true });
    } catch (err) {
      req.log.error({ err }, "Stripe webhook processing error");
      return res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// WhatsApp Cloud API webhook verification handshake (Meta GETs this once with a
// challenge it expects echoed back when the verify token matches).
app.get("/api/whatsapp/webhook", (req, res) => {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (
    verifyToken &&
    mode === "subscribe" &&
    typeof token === "string" &&
    token === verifyToken &&
    typeof challenge === "string"
  ) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// WhatsApp inbound webhook (delivery statuses + STOP replies). Must receive the
// raw body for HMAC verification, so it is registered BEFORE express.json().
// Always acks 200 so Meta does not retry; only verified payloads are processed.
app.post(
  "/api/whatsapp/webhook",
  express.raw({ type: () => true }),
  async (req, res) => {
    const signature = req.headers["x-hub-signature-256"];
    const sig = Array.isArray(signature) ? signature[0] : signature;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyWebhookSignature(raw, sig)) {
      // Unverifiable (bad signature or no app secret): ack without processing.
      return res.sendStatus(200);
    }
    try {
      const payload = JSON.parse(raw.toString("utf8"));
      await processWhatsappWebhook(payload);
    } catch (err) {
      req.log.error({ err }, "WhatsApp webhook processing error");
    }
    return res.sendStatus(200);
  },
);

// Credentialed CORS must use a strict origin allowlist (never reflect arbitrary
// origins while `credentials: true`). Trusted origins are the app's own Replit
// domains; requests without an Origin header (same-origin via the shared proxy,
// curl, server-to-server) are allowed through.
const allowedOrigins = new Set<string>();
for (const domain of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
  const trimmed = domain.trim();
  if (trimmed) allowedOrigins.add(`https://${trimmed}`);
}
if (process.env.REPLIT_DEV_DOMAIN) {
  allowedOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Resolve the publishable key from the incoming request host so the same server
// can serve multiple Clerk custom domains. Falls back to CLERK_PUBLISHABLE_KEY
// when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
