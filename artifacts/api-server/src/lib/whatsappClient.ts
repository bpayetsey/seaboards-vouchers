import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * Thin wrapper over the Meta WhatsApp Cloud API (graph.facebook.com).
 *
 * Every credential is read from environment secrets and never hardcoded. When
 * the required secrets are absent the tool degrades gracefully: the admin UI
 * runs in "preview mode" (no templates, sends disabled) instead of crashing.
 * Secrets used:
 *   - WHATSAPP_ACCESS_TOKEN        (Bearer for all Graph calls)
 *   - WHATSAPP_PHONE_NUMBER_ID     (sender, POST {id}/messages)
 *   - WHATSAPP_BUSINESS_ACCOUNT_ID (WABA, GET {id}/message_templates)
 *   - WHATSAPP_APP_SECRET          (HMAC verify inbound webhooks)
 *   - WHATSAPP_WEBHOOK_VERIFY_TOKEN(GET webhook handshake)
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WhatsappCredentials {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
}

/** True when sending is possible (token + sender number are present). */
export function isWhatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
}

function getCredentials(): WhatsappCredentials | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "";
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId, businessAccountId };
}

export interface WhatsappTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  variableCount: number;
  /** Header media requirement: NONE | TEXT | IMAGE | VIDEO | DOCUMENT. */
  headerFormat: string;
}

interface GraphTemplateComponent {
  type?: string;
  text?: string;
  format?: string;
}

interface GraphTemplate {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: GraphTemplateComponent[];
}

/** Count distinct {{1}}..{{n}} positional placeholders in a template body. */
function countVariables(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  const nums = new Set(
    matches.map((m) => Number(m.replace(/[^\d]/g, ""))).filter((n) => n > 0),
  );
  return nums.size;
}

/**
 * Fetch APPROVED message templates from the WhatsApp Business Account. Returns
 * an empty list (never throws) when unconfigured so the composer degrades
 * gracefully. Only approved templates are returned — marketing sends must use a
 * Meta-approved template.
 */
export async function fetchApprovedTemplates(): Promise<WhatsappTemplate[]> {
  const creds = getCredentials();
  if (!creds || !creds.businessAccountId) return [];

  const url = `${GRAPH_BASE}/${creds.businessAccountId}/message_templates?fields=name,status,category,language,components&limit=200`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn({ err }, "WhatsApp template fetch failed");
    return [];
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, detail },
      "WhatsApp template fetch non-2xx",
    );
    return [];
  }

  const data = (await resp.json()) as { data?: GraphTemplate[] };
  const templates: WhatsappTemplate[] = [];
  for (const t of data.data ?? []) {
    if (!t.name || (t.status ?? "").toUpperCase() !== "APPROVED") continue;
    const bodyComp = (t.components ?? []).find(
      (c) => (c.type ?? "").toUpperCase() === "BODY",
    );
    const headerComp = (t.components ?? []).find(
      (c) => (c.type ?? "").toUpperCase() === "HEADER",
    );
    const body = bodyComp?.text ?? "";
    templates.push({
      name: t.name,
      language: t.language ?? "en_US",
      category: t.category ?? "MARKETING",
      body,
      variableCount: countVariables(body),
      headerFormat: (headerComp?.format ?? "NONE").toUpperCase(),
    });
  }
  return templates;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Send a single template message. `variables` are the ordered positional body
 * parameters ({{1}}, {{2}}, ...). Returns a result object instead of throwing
 * so the campaign sender can record a per-recipient failure and continue.
 */
export async function sendTemplateMessage(input: {
  to: string;
  templateName: string;
  languageCode: string;
  variables: string[];
  headerMedia?: { type: "image" | "video" | "document"; id: string } | null;
}): Promise<SendResult> {
  const creds = getCredentials();
  if (!creds) return { ok: false, error: "not_configured" };

  const components: Array<Record<string, unknown>> = [];
  if (input.headerMedia) {
    // Header media is referenced by a pre-uploaded media id (not a link), which
    // avoids Meta's "media upload error" (131053) when it can't fetch a URL.
    components.push({
      type: "header",
      parameters: [
        {
          type: input.headerMedia.type,
          [input.headerMedia.type]: { id: input.headerMedia.id },
        },
      ],
    });
  }
  if (input.variables.length > 0) {
    components.push({
      type: "body",
      parameters: input.variables.map((text) => ({ type: "text", text })),
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `network_error: ${String(err)}` };
  }

  const data = (await resp.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; code?: number };
  };

  if (!resp.ok) {
    const message =
      data.error?.message ?? `${resp.status} ${resp.statusText}`.trim();
    return { ok: false, error: message };
  }

  const messageId = data.messages?.[0]?.id;
  if (!messageId) return { ok: false, error: "no_message_id" };
  return { ok: true, messageId };
}

export type UploadMediaResult =
  | { ok: true; mediaId: string }
  | { ok: false; error: string };

/**
 * Upload a media file (image/video/document) to the WhatsApp media API and
 * return a reusable media id (~30 day validity) for use as a template header.
 * Uploading once and referencing the id avoids per-send link fetches that Meta
 * can fail to retrieve (error 131053).
 */
export async function uploadMedia(input: {
  data: Buffer;
  mimeType: string;
  filename: string;
}): Promise<UploadMediaResult> {
  const creds = getCredentials();
  if (!creds) return { ok: false, error: "not_configured" };

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mimeType);
  form.append(
    "file",
    new Blob([new Uint8Array(input.data)], { type: input.mimeType }),
    input.filename,
  );

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return { ok: false, error: `network_error: ${String(err)}` };
  }

  const data = (await resp.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!resp.ok) {
    return {
      ok: false,
      error: data.error?.message ?? `${resp.status} ${resp.statusText}`.trim(),
    };
  }
  if (!data.id) return { ok: false, error: "no_media_id" };
  return { ok: true, mediaId: data.id };
}

/**
 * Verify the X-Hub-Signature-256 header against the raw request body using the
 * app secret. Returns false when the secret is unset so callers can ack-without-
 * processing rather than trusting unverifiable payloads.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/** The configured sender phone number id, for display in the admin UI. */
export function getSenderNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? null;
}
