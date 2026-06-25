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

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
