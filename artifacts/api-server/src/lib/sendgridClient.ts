import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * SendGrid transactional email, wired through the Replit SendGrid connection.
 *
 * Credentials are fetched fresh on every send (never cached) so a rotated key
 * is picked up immediately, mirroring the Stripe connector pattern. In a
 * deployment, explicit `SENDGRID_*` secrets take precedence so the published
 * app can use a dedicated account without touching the connector.
 */
interface SendgridCredentials {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

let cachedFromWarningLogged = false;

export async function getSendgridCredentials(): Promise<SendgridCredentials> {
  const envFrom = process.env.SENDGRID_FROM_EMAIL;
  if (process.env.SENDGRID_API_KEY) {
    if (!envFrom) {
      throw new Error(
        "SENDGRID_API_KEY is set but SENDGRID_FROM_EMAIL is missing. " +
          "Set a verified sender address.",
      );
    }
    return {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: envFrom,
      fromName: process.env.SENDGRID_FROM_NAME || undefined,
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
        "Ensure the SendGrid integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch SendGrid credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    items?: Array<{
      environment?: string;
      settings?: {
        api_key?: string;
        apiKey?: string;
        secret?: string;
        from_email?: string;
        fromEmail?: string;
        from_name?: string;
      };
    }>;
  };
  // Prefer the connection matching the current runtime environment (mirrors the
  // Stripe connector selection); fall back to the first when only one exists.
  const items = data.items ?? [];
  const targetEnv =
    process.env.REPLIT_DEPLOYMENT === "1" ? "production" : "development";
  const selected =
    items.find((item) => item.environment === targetEnv) ?? items[0];
  const settings = selected?.settings;

  const apiKey = settings?.api_key ?? settings?.apiKey ?? settings?.secret;
  if (!apiKey) {
    throw new Error(
      "SendGrid integration not connected or missing API key. " +
        "Connect SendGrid via the Integrations tab first.",
    );
  }

  // The verified sender address can come from the connection or be overridden
  // by an env var. Without one SendGrid rejects the send, so fail loudly.
  const fromEmail = envFrom ?? settings?.from_email ?? settings?.fromEmail;
  if (!fromEmail) {
    throw new Error(
      "No SendGrid sender address available. Set SENDGRID_FROM_EMAIL to a " +
        "verified sender.",
    );
  }

  return {
    apiKey,
    fromEmail,
    fromName: process.env.SENDGRID_FROM_NAME || settings?.from_name || undefined,
  };
}

export interface EmailAttachment {
  /** Base64-encoded file contents. */
  content: string;
  filename: string;
  type: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

/**
 * Send a single transactional email via the SendGrid v3 API. Throws on any
 * non-2xx response so callers can decide whether to retry; voucher callers
 * treat a throw as "not yet sent" and clear their idempotency claim.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { apiKey, fromEmail, fromName } = await getSendgridCredentials();

  const body = {
    personalizations: [{ to: [{ email: input.to }] }],
    from: fromName
      ? { email: fromEmail, name: fromName }
      : { email: fromEmail },
    subject: input.subject,
    content: [
      { type: "text/plain", value: input.text },
      { type: "text/html", value: input.html },
    ],
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((a) => ({
            content: a.content,
            filename: a.filename,
            type: a.type,
            disposition: "attachment",
          })),
        }
      : {}),
  };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    if (!cachedFromWarningLogged && resp.status === 403) {
      cachedFromWarningLogged = true;
      logger.warn(
        "SendGrid returned 403 — verify the sender address is authorised.",
      );
    }
    throw new Error(
      `SendGrid send failed: ${resp.status} ${resp.statusText} ${detail}`.trim(),
    );
  }
}

// ---------------------------------------------------------------------------
// Marketing / campaign sending
// ---------------------------------------------------------------------------

export interface SendgridSender {
  email: string;
  name?: string;
}

/**
 * Whether SendGrid sending is possible right now. Mirrors the WhatsApp
 * "configured?" check but is async because credentials may come from the Replit
 * connector (a network lookup) rather than env vars. Never throws — used by the
 * config endpoint and the dispatcher to degrade gracefully when unconfigured.
 */
export async function isSendgridConfigured(): Promise<boolean> {
  try {
    await getSendgridCredentials();
    return true;
  } catch {
    return false;
  }
}

/** The verified sender (email + optional name) for display, or null if unset. */
export async function getSendgridSender(): Promise<SendgridSender | null> {
  try {
    const { fromEmail, fromName } = await getSendgridCredentials();
    return { email: fromEmail, name: fromName };
  } catch {
    return null;
  }
}

export type CampaignSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Send a single marketing email and return SendGrid's X-Message-Id so the
 * campaign sender can record it and later correlate delivery/open events from
 * the Event Webhook. Returns a result object instead of throwing so a
 * per-recipient failure is recorded and the batch continues (mirrors the
 * WhatsApp sendTemplateMessage contract). Custom `headers` carry the
 * List-Unsubscribe one-click headers.
 */
export async function sendCampaignEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}): Promise<CampaignSendResult> {
  let creds: SendgridCredentials;
  try {
    creds = await getSendgridCredentials();
  } catch {
    return { ok: false, error: "not_configured" };
  }

  const body = {
    personalizations: [{ to: [{ email: input.to }] }],
    from: creds.fromName
      ? { email: creds.fromEmail, name: creds.fromName }
      : { email: creds.fromEmail },
    subject: input.subject,
    content: [
      { type: "text/plain", value: input.text },
      { type: "text/html", value: input.html },
    ],
    ...(input.headers && Object.keys(input.headers).length > 0
      ? { headers: input.headers }
      : {}),
  };

  let resp: Response;
  try {
    resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `network_error: ${String(err)}` };
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return {
      ok: false,
      error: `${resp.status} ${resp.statusText} ${detail}`.trim(),
    };
  }

  // SendGrid returns 202 with the message id in the X-Message-Id header; the
  // Event Webhook later reports sg_message_id as "<X-Message-Id>.recvd-...".
  const messageId = resp.headers.get("x-message-id") ?? "";
  if (!messageId) return { ok: false, error: "no_message_id" };
  return { ok: true, messageId };
}

/**
 * Verify a SendGrid Event Webhook payload using the ECDSA (P-256) public key
 * from SENDGRID_WEBHOOK_VERIFICATION_KEY. The signed message is
 * `timestamp + rawBody`. Returns "unconfigured" when no key is set so the
 * caller can choose to process unsigned events (status advancement only).
 */
export function verifyEventWebhookSignature(
  rawBody: Buffer,
  signatureB64: string | undefined,
  timestamp: string | undefined,
): boolean | "unconfigured" {
  const publicKeyB64 = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!publicKeyB64) return "unconfigured";
  if (!signatureB64 || !timestamp) return false;

  try {
    const keyObject = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const verifier = crypto.createVerify("sha256");
    verifier.update(timestamp);
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(
      keyObject,
      Buffer.from(signatureB64, "base64"),
    );
  } catch (err) {
    logger.warn({ err }, "SendGrid event webhook signature verify failed");
    return false;
  }
}
