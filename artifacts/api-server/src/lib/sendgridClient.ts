import { logger } from "./logger";

/**
 * Fetches SendGrid credentials from the Replit connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time. Mirrors the
 * pattern in stripeClient.ts.
 */
async function getSendgridCredentials(): Promise<{
  apiKey: string;
  fromEmail: string;
}> {
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
      settings?: { api_key?: string; from_email?: string };
    }>;
  };
  const items = data.items ?? [];
  const targetEnv =
    process.env.REPLIT_DEPLOYMENT === "1" ? "production" : "development";
  const selected =
    items.find((item) => item.environment === targetEnv) ?? items[0];
  const settings = selected?.settings;

  if (!settings?.api_key || !settings?.from_email) {
    throw new Error(
      "SendGrid integration not connected or missing api_key/from_email. " +
        "Connect SendGrid via the Integrations tab first.",
    );
  }

  return { apiKey: settings.api_key, fromEmail: settings.from_email };
}

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  type: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Send a transactional email via the SendGrid v3 API. Best-effort: returns
 * `false` and logs on any failure (missing connection, API error) so callers in
 * the payment/webhook path never throw because of email delivery.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  let creds: { apiKey: string; fromEmail: string };
  try {
    creds = await getSendgridCredentials();
  } catch (err) {
    logger.warn({ err, to: input.to }, "Email not sent: SendGrid unavailable");
    return false;
  }

  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: input.to }] }],
    from: { email: creds.fromEmail, name: "The Seaboards Apartments" },
    subject: input.subject,
    content: [
      { type: "text/plain", value: input.text },
      { type: "text/html", value: input.html },
    ],
  };

  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      content: toBase64(a.content),
      filename: a.filename,
      type: a.type,
      disposition: "attachment",
    }));
  }

  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      logger.warn(
        { to: input.to, status: resp.status, detail: detail.slice(0, 500) },
        "Email not sent: SendGrid API error",
      );
      return false;
    }
    logger.info({ to: input.to, subject: input.subject }, "Email sent");
    return true;
  } catch (err) {
    logger.warn({ err, to: input.to }, "Email not sent: request failed");
    return false;
  }
}
