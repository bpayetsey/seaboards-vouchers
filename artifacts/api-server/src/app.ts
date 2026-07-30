import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { processWebhook } from "./lib/webhookHandlers";
import { verifyWebhookSignature } from "./lib/whatsappClient";
import { processWhatsappWebhook } from "./lib/whatsappCampaigns";
import { verifyEventWebhookSignature } from "./lib/sendgridClient";
import { processSendgridEvents } from "./lib/emailCampaigns";

const app: Express = express();

// Trust the platform's edge proxy (Railway) so that req.ip, req.protocol,
// and the x-forwarded-* headers resolve to the real client values rather
// than the internal proxy address. Without this, Express ignores the
// incoming x-forwarded-for chain and req.ip would return the proxy's
// loopback IP, which would cause all users to share the same apparent IP
// for any per-IP rate limiting.
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

// SendGrid Event Webhook (delivery/open/bounce statuses). Must receive the raw
// body for ECDSA signature verification, so it is registered BEFORE express.json().
// Always acks 200 so SendGrid does not retry. When a verification key is
// configured, only verified payloads are processed; when it is not, events are
// processed unsigned (they only advance per-message delivery status).
app.post(
  "/api/email/webhook",
  express.raw({ type: () => true }),
  async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.get(
      "X-Twilio-Email-Event-Webhook-Signature",
    );
    const timestamp = req.get(
      "X-Twilio-Email-Event-Webhook-Timestamp",
    );
    const verdict = verifyEventWebhookSignature(raw, signature, timestamp);
    if (verdict === false) {
      // Key configured but signature invalid: ack without processing.
      return res.sendStatus(200);
    }
    try {
      const payload = JSON.parse(raw.toString("utf8"));
      await processSendgridEvents(payload);
    } catch (err) {
      req.log.error({ err }, "SendGrid event webhook processing error");
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

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
