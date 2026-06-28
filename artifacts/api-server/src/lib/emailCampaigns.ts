import crypto from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  pool,
  emailContacts,
  emailAudiences,
  emailAudienceMembers,
  emailCampaigns,
  emailMessages,
} from "@workspace/db";
import { RESORT } from "@workspace/voucher-content";
import { logger } from "./logger";
import { normalizeEmail } from "./email";
import {
  isSendgridConfigured,
  getSendgridSender,
  sendCampaignEmail,
} from "./sendgridClient";

// ---------------------------------------------------------------------------
// Shapes (snake_case, matching the OpenAPI schemas / generated Zod)
// ---------------------------------------------------------------------------

export interface ApiContact {
  id: string;
  email: string;
  name: string | null;
  consent: string;
  opted_out: boolean;
  opted_out_at: string | null;
  source: string;
  created_at: string;
}

interface ContactRow {
  id: string;
  email: string;
  name: string | null;
  consent: string;
  optedOut: boolean;
  optedOutAt: Date | null;
  source: string;
  createdAt: Date;
}

function toApiContact(c: ContactRow): ApiContact {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    consent: c.consent,
    opted_out: c.optedOut,
    opted_out_at: c.optedOutAt ? c.optedOutAt.toISOString() : null,
    source: c.source,
    created_at: c.createdAt.toISOString(),
  };
}

/** A contact is reachable only when consented AND not opted-out. */
function isEligible(c: { consent: string; optedOut: boolean }): boolean {
  return c.consent === "opted_in" && !c.optedOut;
}

/** Unguessable per-contact token embedded in unsubscribe links. */
function newUnsubscribeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getConfig() {
  const sender = await getSendgridSender();
  return {
    configured: await isSendgridConfigured(),
    from_email: sender?.email ?? null,
    from_name: sender?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function listContacts(opts: {
  search?: string;
  audienceId?: string;
}) {
  const conditions = [];
  if (opts.search && opts.search.trim()) {
    const like = `%${opts.search.trim()}%`;
    conditions.push(
      or(ilike(emailContacts.email, like), ilike(emailContacts.name, like)),
    );
  }

  let rows: ContactRow[];
  if (opts.audienceId) {
    const base = db
      .select({
        id: emailContacts.id,
        email: emailContacts.email,
        name: emailContacts.name,
        consent: emailContacts.consent,
        optedOut: emailContacts.optedOut,
        optedOutAt: emailContacts.optedOutAt,
        source: emailContacts.source,
        createdAt: emailContacts.createdAt,
      })
      .from(emailContacts)
      .innerJoin(
        emailAudienceMembers,
        eq(emailAudienceMembers.contactId, emailContacts.id),
      );
    const where = and(
      eq(emailAudienceMembers.audienceId, opts.audienceId),
      ...conditions,
    );
    rows = await base
      .where(where)
      .orderBy(desc(emailContacts.createdAt))
      .limit(1000);
  } else {
    const where = conditions.length ? and(...conditions) : undefined;
    rows = await db
      .select({
        id: emailContacts.id,
        email: emailContacts.email,
        name: emailContacts.name,
        consent: emailContacts.consent,
        optedOut: emailContacts.optedOut,
        optedOutAt: emailContacts.optedOutAt,
        source: emailContacts.source,
        createdAt: emailContacts.createdAt,
      })
      .from(emailContacts)
      .where(where)
      .orderBy(desc(emailContacts.createdAt))
      .limit(1000);
  }

  const eligible = rows.filter(isEligible).length;
  return {
    contacts: rows.map(toApiContact),
    total: rows.length,
    eligible,
  };
}

export interface ImportRow {
  email: string;
  name?: string | null;
}

export async function importContacts(input: {
  rows: ImportRow[];
  consent?: boolean;
  audience_id?: string | null;
}) {
  const consentValue = input.consent === false ? "unknown" : "opted_in";

  const rejected: Array<{ email: string; name: string | null; reason: string }> =
    [];
  // De-duplicate within the batch, keeping the first occurrence's name.
  const byEmail = new Map<string, { name: string | null }>();
  let inBatchDuplicates = 0;

  for (const raw of input.rows) {
    const result = normalizeEmail(raw.email ?? "");
    if (!result.ok) {
      rejected.push({
        email: raw.email ?? "",
        name: raw.name ?? null,
        reason: result.reason,
      });
      continue;
    }
    if (byEmail.has(result.email)) {
      inBatchDuplicates += 1;
      continue;
    }
    byEmail.set(result.email, { name: raw.name?.trim() || null });
  }

  const emails = [...byEmail.keys()];
  let imported = 0;
  let existingDuplicates = 0;
  const affectedContactIds: string[] = [];

  if (emails.length > 0) {
    const existing = await db
      .select({ id: emailContacts.id, email: emailContacts.email })
      .from(emailContacts)
      .where(inArray(emailContacts.email, emails));
    const existingByEmail = new Map(existing.map((e) => [e.email, e.id]));
    existingDuplicates = existing.length;
    for (const id of existingByEmail.values()) affectedContactIds.push(id);

    const toInsert = emails
      .filter((e) => !existingByEmail.has(e))
      .map((email) => ({
        email,
        name: byEmail.get(email)?.name ?? null,
        consent: consentValue,
        unsubscribeToken: newUnsubscribeToken(),
        source: "import",
      }));

    if (toInsert.length > 0) {
      const inserted = await db
        .insert(emailContacts)
        .values(toInsert)
        .returning({ id: emailContacts.id });
      imported = inserted.length;
      for (const r of inserted) affectedContactIds.push(r.id);
    }
  }

  // Optionally add every imported + matched contact to an audience.
  if (input.audience_id && affectedContactIds.length > 0) {
    const audience = await db
      .select({ id: emailAudiences.id })
      .from(emailAudiences)
      .where(eq(emailAudiences.id, input.audience_id))
      .limit(1);
    if (audience.length > 0) {
      await db
        .insert(emailAudienceMembers)
        .values(
          affectedContactIds.map((contactId) => ({
            audienceId: input.audience_id as string,
            contactId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return {
    total: input.rows.length,
    imported,
    duplicates: existingDuplicates + inBatchDuplicates,
    rejected,
  };
}

export async function optOutContact(
  contactId: string,
): Promise<ApiContact | null> {
  const [updated] = await db
    .update(emailContacts)
    .set({ optedOut: true, optedOutAt: new Date(), updatedAt: new Date() })
    .where(eq(emailContacts.id, contactId))
    .returning();
  return updated ? toApiContact(updated) : null;
}

/** Opt out by unsubscribe token (public one-click). Idempotent; returns ok. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!token.trim()) return false;
  const updated = await db
    .update(emailContacts)
    .set({ optedOut: true, optedOutAt: new Date(), updatedAt: new Date() })
    .where(eq(emailContacts.unsubscribeToken, token))
    .returning({ id: emailContacts.id });
  return updated.length > 0;
}

export async function deleteContact(contactId: string): Promise<void> {
  await db.delete(emailContacts).where(eq(emailContacts.id, contactId));
}

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

async function audienceCounts(
  audienceIds: string[],
): Promise<Map<string, number>> {
  if (audienceIds.length === 0) return new Map();
  const rows = await db
    .select({
      audienceId: emailAudienceMembers.audienceId,
      count: sql<number>`count(*)::int`,
    })
    .from(emailAudienceMembers)
    .where(inArray(emailAudienceMembers.audienceId, audienceIds))
    .groupBy(emailAudienceMembers.audienceId);
  return new Map(rows.map((r) => [r.audienceId, r.count]));
}

export async function listAudiences() {
  const rows = await db
    .select()
    .from(emailAudiences)
    .orderBy(desc(emailAudiences.createdAt));
  const counts = await audienceCounts(rows.map((r) => r.id));
  return {
    audiences: rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      contact_count: counts.get(a.id) ?? 0,
      created_at: a.createdAt.toISOString(),
    })),
  };
}

async function getAudience(audienceId: string) {
  const [a] = await db
    .select()
    .from(emailAudiences)
    .where(eq(emailAudiences.id, audienceId))
    .limit(1);
  if (!a) return null;
  const counts = await audienceCounts([a.id]);
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    contact_count: counts.get(a.id) ?? 0,
    created_at: a.createdAt.toISOString(),
  };
}

export async function createAudience(input: {
  name: string;
  description?: string | null;
  contact_ids?: string[];
}) {
  const [created] = await db
    .insert(emailAudiences)
    .values({ name: input.name.trim(), description: input.description ?? null })
    .returning();

  if (input.contact_ids && input.contact_ids.length > 0) {
    await db
      .insert(emailAudienceMembers)
      .values(
        input.contact_ids.map((contactId) => ({
          audienceId: created.id,
          contactId,
        })),
      )
      .onConflictDoNothing();
  }

  const result = await getAudience(created.id);
  return result as NonNullable<typeof result>;
}

export async function deleteAudience(audienceId: string): Promise<void> {
  await db.delete(emailAudiences).where(eq(emailAudiences.id, audienceId));
}

export async function updateAudienceMembers(
  audienceId: string,
  input: { add?: string[]; remove?: string[] },
) {
  const exists = await getAudience(audienceId);
  if (!exists) return null;

  if (input.add && input.add.length > 0) {
    await db
      .insert(emailAudienceMembers)
      .values(input.add.map((contactId) => ({ audienceId, contactId })))
      .onConflictDoNothing();
  }
  if (input.remove && input.remove.length > 0) {
    await db
      .delete(emailAudienceMembers)
      .where(
        and(
          eq(emailAudienceMembers.audienceId, audienceId),
          inArray(emailAudienceMembers.contactId, input.remove),
        ),
      );
  }
  return getAudience(audienceId);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

interface Stats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
}

function emptyStats(): Stats {
  return { total: 0, queued: 0, sent: 0, delivered: 0, opened: 0, failed: 0 };
}

async function statsByCampaign(
  campaignIds: string[],
): Promise<Map<string, Stats>> {
  const result = new Map<string, Stats>();
  if (campaignIds.length === 0) return result;
  const rows = await db
    .select({
      campaignId: emailMessages.campaignId,
      status: emailMessages.status,
      count: sql<number>`count(*)::int`,
    })
    .from(emailMessages)
    .where(inArray(emailMessages.campaignId, campaignIds))
    .groupBy(emailMessages.campaignId, emailMessages.status);

  for (const r of rows) {
    const s = result.get(r.campaignId) ?? emptyStats();
    s.total += r.count;
    if (r.status in s) {
      (s as unknown as Record<string, number>)[r.status] += r.count;
    }
    result.set(r.campaignId, s);
  }
  return result;
}

export async function listCampaigns() {
  const rows = await db
    .select({
      id: emailCampaigns.id,
      name: emailCampaigns.name,
      audienceId: emailCampaigns.audienceId,
      audienceName: emailAudiences.name,
      subject: emailCampaigns.subject,
      status: emailCampaigns.status,
      scheduledAt: emailCampaigns.scheduledAt,
      startedAt: emailCampaigns.startedAt,
      completedAt: emailCampaigns.completedAt,
      createdAt: emailCampaigns.createdAt,
    })
    .from(emailCampaigns)
    .leftJoin(emailAudiences, eq(emailAudiences.id, emailCampaigns.audienceId))
    .orderBy(desc(emailCampaigns.createdAt));

  const stats = await statsByCampaign(rows.map((r) => r.id));
  return {
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      audience_id: r.audienceId,
      audience_name: r.audienceName ?? "(deleted)",
      subject: r.subject,
      status: r.status,
      scheduled_at: r.scheduledAt ? r.scheduledAt.toISOString() : null,
      started_at: r.startedAt ? r.startedAt.toISOString() : null,
      completed_at: r.completedAt ? r.completedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
      stats: stats.get(r.id) ?? emptyStats(),
    })),
  };
}

export async function getCampaignDetail(campaignId: string) {
  const [c] = await db
    .select({
      id: emailCampaigns.id,
      name: emailCampaigns.name,
      audienceId: emailCampaigns.audienceId,
      audienceName: emailAudiences.name,
      subject: emailCampaigns.subject,
      body: emailCampaigns.body,
      variables: emailCampaigns.variables,
      status: emailCampaigns.status,
      scheduledAt: emailCampaigns.scheduledAt,
      startedAt: emailCampaigns.startedAt,
      completedAt: emailCampaigns.completedAt,
      createdAt: emailCampaigns.createdAt,
    })
    .from(emailCampaigns)
    .leftJoin(emailAudiences, eq(emailAudiences.id, emailCampaigns.audienceId))
    .where(eq(emailCampaigns.id, campaignId))
    .limit(1);
  if (!c) return null;

  const messages = await db
    .select({
      id: emailMessages.id,
      email: emailMessages.email,
      name: emailContacts.name,
      status: emailMessages.status,
      providerMessageId: emailMessages.providerMessageId,
      error: emailMessages.error,
      sentAt: emailMessages.sentAt,
      createdAt: emailMessages.createdAt,
      updatedAt: emailMessages.updatedAt,
    })
    .from(emailMessages)
    .leftJoin(emailContacts, eq(emailContacts.id, emailMessages.contactId))
    .where(eq(emailMessages.campaignId, campaignId))
    .orderBy(desc(emailMessages.createdAt));

  const stats = emptyStats();
  for (const m of messages) {
    stats.total += 1;
    if (m.status in stats) {
      (stats as unknown as Record<string, number>)[m.status] += 1;
    }
  }

  return {
    id: c.id,
    name: c.name,
    audience_id: c.audienceId,
    audience_name: c.audienceName ?? "(deleted)",
    subject: c.subject,
    body: c.body,
    variables: c.variables ?? [],
    status: c.status,
    scheduled_at: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    started_at: c.startedAt ? c.startedAt.toISOString() : null,
    completed_at: c.completedAt ? c.completedAt.toISOString() : null,
    created_at: c.createdAt.toISOString(),
    stats,
    recipients: messages.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      status: m.status,
      provider_message_id: m.providerMessageId,
      error: m.error,
      sent_at: m.sentAt ? m.sentAt.toISOString() : null,
      created_at: m.createdAt.toISOString(),
      updated_at: m.updatedAt.toISOString(),
    })),
  };
}

export type CreateCampaignResult =
  | { ok: true; id: string }
  | { ok: false; error: "audience_not_found" | "invalid" };

export async function createCampaign(input: {
  name: string;
  audience_id: string;
  subject: string;
  body: string;
  variables?: string[];
  mode?: "draft" | "now" | "schedule";
  scheduled_at?: string | null;
  daily_limit?: number | null;
}): Promise<CreateCampaignResult> {
  const audience = await db
    .select({ id: emailAudiences.id })
    .from(emailAudiences)
    .where(eq(emailAudiences.id, input.audience_id))
    .limit(1);
  if (audience.length === 0) return { ok: false, error: "audience_not_found" };

  if (!input.name.trim() || !input.subject.trim() || !input.body.trim()) {
    return { ok: false, error: "invalid" };
  }

  const mode = input.mode ?? "draft";
  let status = "draft";
  let scheduledAt: Date | null = null;
  let startedAt: Date | null = null;

  if (mode === "schedule") {
    if (!input.scheduled_at) return { ok: false, error: "invalid" };
    scheduledAt = new Date(input.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime()))
      return { ok: false, error: "invalid" };
    status = "scheduled";
  } else if (mode === "now") {
    status = "sending";
    startedAt = new Date();
  }

  const [created] = await db
    .insert(emailCampaigns)
    .values({
      name: input.name.trim(),
      audienceId: input.audience_id,
      subject: input.subject.trim(),
      body: input.body,
      variables: input.variables ?? [],
      status,
      dailyLimit:
        input.daily_limit != null && input.daily_limit > 0
          ? Math.floor(input.daily_limit)
          : null,
      scheduledAt,
      startedAt,
    })
    .returning({ id: emailCampaigns.id });

  if (mode === "now") {
    void dispatchCampaign(created.id).catch((err) =>
      logger.error({ err, campaignId: created.id }, "Campaign dispatch failed"),
    );
  }

  return { ok: true, id: created.id };
}

export type SendCampaignResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "invalid_state" | "invalid" };

export async function sendCampaign(
  campaignId: string,
  input: { mode: "now" | "schedule"; scheduled_at?: string | null },
): Promise<SendCampaignResult> {
  const [c] = await db
    .select({ id: emailCampaigns.id, status: emailCampaigns.status })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId))
    .limit(1);
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "draft" && c.status !== "scheduled") {
    return { ok: false, error: "invalid_state" };
  }

  if (input.mode === "schedule") {
    if (!input.scheduled_at) return { ok: false, error: "invalid" };
    const when = new Date(input.scheduled_at);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "invalid" };
    await db
      .update(emailCampaigns)
      .set({ status: "scheduled", scheduledAt: when })
      .where(eq(emailCampaigns.id, campaignId));
    return { ok: true };
  }

  await db
    .update(emailCampaigns)
    .set({ status: "sending", startedAt: new Date() })
    .where(eq(emailCampaigns.id, campaignId));
  void dispatchCampaign(campaignId).catch((err) =>
    logger.error({ err, campaignId }, "Campaign dispatch failed"),
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BRAND = "#1F3A5F";
const GOLD = "#B8860B";

/**
 * Absolute base URL of the public app (group-vouchers is served at root "/").
 * Uses the published domain in production and the dev domain otherwise so the
 * unsubscribe link works in both environments. Returns "" when neither is set.
 */
function appBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return "";
}

function unsubscribeUrl(token: string): string {
  const base = appBaseUrl();
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fill placeholders in a template string. Positional `{{1}}..{{n}}` are filled
 * from the campaign `variables`; the named `{{name}}` resolves to the
 * recipient's contact name (falling back to "there"). Unknown placeholders are
 * left intact so the composer preview matches what recipients receive.
 */
export function fillTemplate(
  template: string,
  variables: string[],
  contactName: string | null,
): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, contactName?.trim() || "there")
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const idx = Number(n) - 1;
      return variables[idx]?.trim() ? variables[idx] : `{{${n}}}`;
    });
}

/** Wrap the rendered body in a branded, email-client-safe HTML shell. */
function renderHtml(bodyText: string, token: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(
          p,
        ).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  const unsub = unsubscribeUrl(token);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F8F6F1;font-family:Georgia,'Times New Roman',serif;color:#2A2E35;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:8px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-weight:bold;">${RESORT.jubileeTagline}</div>
    </div>
    <div style="background:#ffffff;border:1px solid #E4E0D8;border-radius:16px;padding:32px;color:${BRAND};">
      ${paragraphs}
    </div>
    <p style="text-align:center;color:#9aa0a6;font-size:12px;margin-top:24px;">
      ${RESORT.name}<br/>
      <a href="${unsub}" style="color:#9aa0a6;text-decoration:underline;">Unsubscribe</a> from these emails.
    </p>
  </div></body></html>`;
}

function renderText(bodyText: string, token: string): string {
  return `${bodyText}\n\n—\n${RESORT.name}\nUnsubscribe: ${unsubscribeUrl(token)}`;
}

// ---------------------------------------------------------------------------
// Sender engine
// ---------------------------------------------------------------------------

function sendDelayMs(): number {
  const raw = Number(process.env.EMAIL_SEND_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Materialize the recipient list for a campaign (eligible audience members that
 * don't already have a message row) and send each email sequentially with a
 * small throttle. Per-recipient outcomes are persisted so a partial failure
 * never loses progress. Safe to call again (idempotent enqueue + only sends
 * rows still queued).
 */
export async function dispatchCampaign(campaignId: string): Promise<void> {
  // Serialize dispatch per campaign with a Postgres session advisory lock held
  // on a dedicated connection for the whole run. This makes the daily-cap
  // headroom calculation safe: without it, two overlapping dispatchers (e.g. a
  // manual "send now" racing the daily scheduler) could each read the same
  // remaining budget and together overshoot the cap. If the lock is already
  // held, another dispatcher is running this campaign — skip; it covers the work
  // (and remaining queued rows are picked up on the next scheduled run).
  const client = await pool.connect();
  try {
    const locked = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('email_dispatch'), hashtext($1)) AS ok",
      [campaignId],
    );
    if (!locked.rows[0]?.ok) {
      logger.info({ campaignId }, "Dispatch already running; skipping");
      return;
    }
    try {
      await runDispatch(campaignId);
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('email_dispatch'), hashtext($1))",
        [campaignId],
      );
    }
  } finally {
    client.release();
  }
}

async function runDispatch(campaignId: string): Promise<void> {
  const [campaign] = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId))
    .limit(1);
  if (!campaign) return;

  if (campaign.status !== "sending") {
    await db
      .update(emailCampaigns)
      .set({ status: "sending", startedAt: campaign.startedAt ?? new Date() })
      .where(eq(emailCampaigns.id, campaignId));
  }

  // Eligible audience members (consented, not opted-out).
  const members = await db
    .select({
      contactId: emailContacts.id,
      email: emailContacts.email,
      consent: emailContacts.consent,
      optedOut: emailContacts.optedOut,
    })
    .from(emailAudienceMembers)
    .innerJoin(
      emailContacts,
      eq(emailContacts.id, emailAudienceMembers.contactId),
    )
    .where(eq(emailAudienceMembers.audienceId, campaign.audienceId));

  const eligible = members.filter(isEligible);

  // Idempotent enqueue: skip contacts that already have a row for this campaign.
  const existing = await db
    .select({ contactId: emailMessages.contactId })
    .from(emailMessages)
    .where(eq(emailMessages.campaignId, campaignId));
  const existingContacts = new Set(
    existing.map((e) => e.contactId).filter(Boolean) as string[],
  );

  const toEnqueue = eligible.filter((m) => !existingContacts.has(m.contactId));
  if (toEnqueue.length > 0) {
    // onConflictDoNothing against the (campaign_id, contact_id) unique index is
    // the hard guard: two dispatchers racing the same campaign can't double-row
    // a recipient even if both pass the read-based filter above.
    await db
      .insert(emailMessages)
      .values(
        toEnqueue.map((m) => ({
          campaignId,
          contactId: m.contactId,
          email: m.email,
          status: "queued",
        })),
      )
      .onConflictDoNothing({
        target: [emailMessages.campaignId, emailMessages.contactId],
      });
  }

  // Send everything still queued. Each row is atomically claimed (queued ->
  // sending) before the provider call, so a concurrent dispatcher that selected
  // the same row loses the race and skips it — guaranteeing exactly one send per
  // recipient.
  const queued = await db
    .select({
      id: emailMessages.id,
      email: emailMessages.email,
      contactName: emailContacts.name,
      unsubscribeToken: emailContacts.unsubscribeToken,
    })
    .from(emailMessages)
    .leftJoin(emailContacts, eq(emailContacts.id, emailMessages.contactId))
    .where(
      and(
        eq(emailMessages.campaignId, campaignId),
        eq(emailMessages.status, "queued"),
      ),
    );

  const configured = await isSendgridConfigured();
  const delay = sendDelayMs();

  // Daily cap: count successful sends in the trailing 24h and only send up to
  // the remaining headroom this run. A capped campaign therefore sends at most
  // dailyLimit per rolling day and is resumed by the next scheduled dispatch
  // (it stays in `sending` while rows remain queued). NULL = unlimited.
  let remaining = Number.POSITIVE_INFINITY;
  if (campaign.dailyLimit != null) {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ sentInWindow }] = await db
      .select({ sentInWindow: sql<number>`count(*)::int` })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.campaignId, campaignId),
          isNotNull(emailMessages.sentAt),
          gte(emailMessages.sentAt, windowStart),
        ),
      );
    remaining = Math.max(0, campaign.dailyLimit - sentInWindow);
  }

  let sentThisRun = 0;
  for (const msg of queued) {
    if (sentThisRun >= remaining) break;
    const claimed = await db
      .update(emailMessages)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(emailMessages.id, msg.id),
          eq(emailMessages.status, "queued"),
        ),
      )
      .returning({ id: emailMessages.id });
    if (claimed.length === 0) continue; // another dispatcher already took it

    if (!configured) {
      await db
        .update(emailMessages)
        .set({
          status: "failed",
          error: "SendGrid sender not configured",
          updatedAt: new Date(),
        })
        .where(eq(emailMessages.id, msg.id));
      continue;
    }

    // A contact deleted between enqueue and send leaves no token; treat as a
    // failure rather than emailing without a working unsubscribe link.
    const token = msg.unsubscribeToken;
    if (!token) {
      await db
        .update(emailMessages)
        .set({
          status: "failed",
          error: "Contact removed before send",
          updatedAt: new Date(),
        })
        .where(eq(emailMessages.id, msg.id));
      continue;
    }

    const vars = campaign.variables ?? [];
    const subject = fillTemplate(campaign.subject, vars, msg.contactName);
    const bodyText = fillTemplate(campaign.body, vars, msg.contactName);
    const unsub = unsubscribeUrl(token);

    const result = await sendCampaignEmail({
      to: msg.email,
      subject,
      text: renderText(bodyText, token),
      html: renderHtml(bodyText, token),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (result.ok) {
      sentThisRun += 1;
      await db
        .update(emailMessages)
        .set({
          status: "sent",
          providerMessageId: result.messageId,
          error: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailMessages.id, msg.id));
    } else {
      await db
        .update(emailMessages)
        .set({ status: "failed", error: result.error, updatedAt: new Date() })
        .where(eq(emailMessages.id, msg.id));
    }

    if (delay > 0) await sleep(delay);
  }

  // Only complete the campaign once no row is still queued or mid-send, so a
  // concurrent dispatcher that drained 0 rows can't prematurely mark it done
  // while another is still sending.
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.campaignId, campaignId),
        inArray(emailMessages.status, ["queued", "sending"]),
      ),
    );
  if (pending === 0) {
    await db
      .update(emailCampaigns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(emailCampaigns.id, campaignId));
  }
}

/**
 * Backstop for scheduled and stuck campaigns. Picks up scheduled campaigns
 * whose time has arrived and any campaign left in `sending` (e.g. a process
 * restart mid-send) and dispatches them. Intended to be poked by a scheduler
 * hitting the bearer-protected dispatch endpoint.
 */
export async function dispatchDueCampaigns(): Promise<{ dispatched: number }> {
  const now = new Date();
  const due = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(
      or(
        and(
          eq(emailCampaigns.status, "scheduled"),
          sql`${emailCampaigns.scheduledAt} <= ${now}`,
        ),
        eq(emailCampaigns.status, "sending"),
      ),
    );

  for (const c of due) {
    await dispatchCampaign(c.id);
  }
  return { dispatched: due.length };
}

// ---------------------------------------------------------------------------
// Event webhook processing (delivery / open status)
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
};

interface SendgridEvent {
  event?: string;
  sg_message_id?: string;
  reason?: string;
}

/**
 * Apply a batch of SendGrid Event Webhook events: advance per-message delivery
 * statuses (never downgrading). Events are correlated by `sg_message_id`, which
 * SendGrid formats as "<X-Message-Id>.recvd-..." — we match on the X-Message-Id
 * prefix we stored at send time. Callers should verify the signature first.
 */
export async function processSendgridEvents(payload: unknown): Promise<void> {
  if (!Array.isArray(payload)) return;
  for (const raw of payload as SendgridEvent[]) {
    await applyEvent(raw);
  }
}

async function applyEvent(ev: SendgridEvent): Promise<void> {
  if (!ev.event || !ev.sg_message_id) return;
  // sg_message_id is "<X-Message-Id>.<suffix>"; the prefix matches what we saved.
  const messageId = ev.sg_message_id.split(".")[0];
  if (!messageId) return;

  const mapped = mapEventToStatus(ev.event);
  if (!mapped) return;

  const [existing] = await db
    .select({ id: emailMessages.id, status: emailMessages.status })
    .from(emailMessages)
    .where(eq(emailMessages.providerMessageId, messageId))
    .limit(1);
  if (!existing) return;

  if (mapped === "failed") {
    await db
      .update(emailMessages)
      .set({
        status: "failed",
        error: ev.reason ?? ev.event ?? "failed",
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, existing.id));
    return;
  }

  // Only advance forward; never downgrade (opened -> delivered is ignored).
  const currentRank = STATUS_RANK[existing.status] ?? -1;
  const nextRank = STATUS_RANK[mapped] ?? -1;
  if (nextRank > currentRank) {
    await db
      .update(emailMessages)
      .set({ status: mapped, updatedAt: new Date() })
      .where(eq(emailMessages.id, existing.id));
  }
}

/** Translate a SendGrid event name to our internal message status. */
function mapEventToStatus(event: string): string | null {
  switch (event) {
    case "delivered":
      return "delivered";
    case "open":
      return "opened";
    case "bounce":
    case "dropped":
    case "deferred":
    case "blocked":
      return "failed";
    default:
      return null; // processed, click, spamreport, unsubscribe, etc. ignored
  }
}
