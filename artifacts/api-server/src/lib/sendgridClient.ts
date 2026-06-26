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
