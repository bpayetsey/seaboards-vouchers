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
  whatsappContacts,
  whatsappAudiences,
  whatsappAudienceMembers,
  whatsappCampaigns,
  whatsappMessages,
  inboundMessages,
} from "@workspace/db";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import {
  fetchApprovedTemplates,
  isWhatsappConfigured,
  getSenderNumberId,
  sendTemplateMessage,
} from "./whatsappClient";

// ---------------------------------------------------------------------------
// Shapes (snake_case, matching the OpenAPI schemas / generated Zod)
// ---------------------------------------------------------------------------

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  consent: string;
  opted_out: boolean;
  opted_out_at: string | null;
  source: string;
  created_at: string;
}

interface ContactRow {
  id: string;
  phone: string;
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
    phone: c.phone,
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

// ---------------------------------------------------------------------------
// Config + templates
// ---------------------------------------------------------------------------

export async function getConfig() {
  const templates = await fetchApprovedTemplates();
  return {
    configured: isWhatsappConfigured(),
    from_number: getSenderNumberId(),
    templates: templates.map((t) => ({
      name: t.name,
      language: t.language,
      category: t.category,
      body: t.body,
      variable_count: t.variableCount,
      header_format: t.headerFormat,
    })),
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
      or(ilike(whatsappContacts.phone, like), ilike(whatsappContacts.name, like)),
    );
  }

  let rows: ContactRow[];
  if (opts.audienceId) {
    const base = db
      .select({
        id: whatsappContacts.id,
        phone: whatsappContacts.phone,
        name: whatsappContacts.name,
        consent: whatsappContacts.consent,
        optedOut: whatsappContacts.optedOut,
        optedOutAt: whatsappContacts.optedOutAt,
        source: whatsappContacts.source,
        createdAt: whatsappContacts.createdAt,
      })
      .from(whatsappContacts)
      .innerJoin(
        whatsappAudienceMembers,
        eq(whatsappAudienceMembers.contactId, whatsappContacts.id),
      );
    const where = and(
      eq(whatsappAudienceMembers.audienceId, opts.audienceId),
      ...conditions,
    );
    rows = await base
      .where(where)
      .orderBy(desc(whatsappContacts.createdAt))
      .limit(1000);
  } else {
    const where = conditions.length ? and(...conditions) : undefined;
    rows = await db
      .select()
      .from(whatsappContacts)
      .where(where)
      .orderBy(desc(whatsappContacts.createdAt))
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
  phone: string;
  name?: string | null;
}

export async function importContacts(input: {
  rows: ImportRow[];
  default_country?: string | null;
  consent?: boolean;
  audience_id?: string | null;
}) {
  const consentValue = input.consent === false ? "unknown" : "opted_in";
  const defaultCountry = input.default_country ?? undefined;

  const rejected: Array<{ phone: string; name: string | null; reason: string }> =
    [];
  // De-duplicate within the batch, keeping the first occurrence's name.
  const byPhone = new Map<string, { name: string | null }>();
  let inBatchDuplicates = 0;

  for (const raw of input.rows) {
    const result = normalizePhone(raw.phone ?? "", defaultCountry);
    if (!result.ok) {
      rejected.push({
        phone: raw.phone ?? "",
        name: raw.name ?? null,
        reason: result.reason,
      });
      continue;
    }
    if (byPhone.has(result.e164)) {
      inBatchDuplicates += 1;
      continue;
    }
    byPhone.set(result.e164, { name: raw.name?.trim() || null });
  }

  const phones = [...byPhone.keys()];
  let imported = 0;
  let existingDuplicates = 0;
  const affectedContactIds: string[] = [];

  if (phones.length > 0) {
    const existing = await db
      .select({ id: whatsappContacts.id, phone: whatsappContacts.phone })
      .from(whatsappContacts)
      .where(inArray(whatsappContacts.phone, phones));
    const existingByPhone = new Map(existing.map((e) => [e.phone, e.id]));
    existingDuplicates = existing.length;
    for (const id of existingByPhone.values()) affectedContactIds.push(id);

    const toInsert = phones
      .filter((p) => !existingByPhone.has(p))
      .map((phone) => ({
        phone,
        name: byPhone.get(phone)?.name ?? null,
        consent: consentValue,
        source: "import",
      }));

    if (toInsert.length > 0) {
      const inserted = await db
        .insert(whatsappContacts)
        .values(toInsert)
        .returning({ id: whatsappContacts.id });
      imported = inserted.length;
      for (const r of inserted) affectedContactIds.push(r.id);
    }
  }

  // Optionally add every imported + matched contact to an audience.
  if (input.audience_id && affectedContactIds.length > 0) {
    const audience = await db
      .select({ id: whatsappAudiences.id })
      .from(whatsappAudiences)
      .where(eq(whatsappAudiences.id, input.audience_id))
      .limit(1);
    if (audience.length > 0) {
      await db
        .insert(whatsappAudienceMembers)
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
    .update(whatsappContacts)
    .set({ optedOut: true, optedOutAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappContacts.id, contactId))
    .returning();
  return updated ? toApiContact(updated) : null;
}

/** Opt out by phone (used by inbound STOP). Idempotent; silent if unknown. */
export async function optOutByPhone(phoneE164: string): Promise<void> {
  await db
    .update(whatsappContacts)
    .set({ optedOut: true, optedOutAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappContacts.phone, phoneE164));
}

export async function deleteContact(contactId: string): Promise<void> {
  await db.delete(whatsappContacts).where(eq(whatsappContacts.id, contactId));
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
      audienceId: whatsappAudienceMembers.audienceId,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsappAudienceMembers)
    .where(inArray(whatsappAudienceMembers.audienceId, audienceIds))
    .groupBy(whatsappAudienceMembers.audienceId);
  return new Map(rows.map((r) => [r.audienceId, r.count]));
}

export async function listAudiences() {
  const rows = await db
    .select()
    .from(whatsappAudiences)
    .orderBy(desc(whatsappAudiences.createdAt));
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
    .from(whatsappAudiences)
    .where(eq(whatsappAudiences.id, audienceId))
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
    .insert(whatsappAudiences)
    .values({ name: input.name.trim(), description: input.description ?? null })
    .returning();

  if (input.contact_ids && input.contact_ids.length > 0) {
    await db
      .insert(whatsappAudienceMembers)
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
  await db.delete(whatsappAudiences).where(eq(whatsappAudiences.id, audienceId));
}

export async function updateAudienceMembers(
  audienceId: string,
  input: { add?: string[]; remove?: string[] },
) {
  const exists = await getAudience(audienceId);
  if (!exists) return null;

  if (input.add && input.add.length > 0) {
    await db
      .insert(whatsappAudienceMembers)
      .values(input.add.map((contactId) => ({ audienceId, contactId })))
      .onConflictDoNothing();
  }
  if (input.remove && input.remove.length > 0) {
    await db
      .delete(whatsappAudienceMembers)
      .where(
        and(
          eq(whatsappAudienceMembers.audienceId, audienceId),
          inArray(whatsappAudienceMembers.contactId, input.remove),
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
  read: number;
  failed: number;
}

function emptyStats(): Stats {
  return { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
}

async function statsByCampaign(
  campaignIds: string[],
): Promise<Map<string, Stats>> {
  const result = new Map<string, Stats>();
  if (campaignIds.length === 0) return result;
  const rows = await db
    .select({
      campaignId: whatsappMessages.campaignId,
      status: whatsappMessages.status,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsappMessages)
    .where(inArray(whatsappMessages.campaignId, campaignIds))
    .groupBy(whatsappMessages.campaignId, whatsappMessages.status);

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
      id: whatsappCampaigns.id,
      name: whatsappCampaigns.name,
      audienceId: whatsappCampaigns.audienceId,
      audienceName: whatsappAudiences.name,
      templateName: whatsappCampaigns.templateName,
      templateLanguage: whatsappCampaigns.templateLanguage,
      status: whatsappCampaigns.status,
      scheduledAt: whatsappCampaigns.scheduledAt,
      startedAt: whatsappCampaigns.startedAt,
      completedAt: whatsappCampaigns.completedAt,
      createdAt: whatsappCampaigns.createdAt,
    })
    .from(whatsappCampaigns)
    .leftJoin(
      whatsappAudiences,
      eq(whatsappAudiences.id, whatsappCampaigns.audienceId),
    )
    .orderBy(desc(whatsappCampaigns.createdAt));

  const stats = await statsByCampaign(rows.map((r) => r.id));
  return {
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      audience_id: r.audienceId,
      audience_name: r.audienceName ?? "(deleted)",
      template_name: r.templateName,
      template_language: r.templateLanguage,
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
      id: whatsappCampaigns.id,
      name: whatsappCampaigns.name,
      audienceId: whatsappCampaigns.audienceId,
      audienceName: whatsappAudiences.name,
      templateName: whatsappCampaigns.templateName,
      templateLanguage: whatsappCampaigns.templateLanguage,
      variables: whatsappCampaigns.variables,
      status: whatsappCampaigns.status,
      scheduledAt: whatsappCampaigns.scheduledAt,
      startedAt: whatsappCampaigns.startedAt,
      completedAt: whatsappCampaigns.completedAt,
      createdAt: whatsappCampaigns.createdAt,
    })
    .from(whatsappCampaigns)
    .leftJoin(
      whatsappAudiences,
      eq(whatsappAudiences.id, whatsappCampaigns.audienceId),
    )
    .where(eq(whatsappCampaigns.id, campaignId))
    .limit(1);
  if (!c) return null;

  const messages = await db
    .select({
      id: whatsappMessages.id,
      phone: whatsappMessages.phone,
      name: whatsappContacts.name,
      status: whatsappMessages.status,
      providerMessageId: whatsappMessages.providerMessageId,
      error: whatsappMessages.error,
      sentAt: whatsappMessages.sentAt,
      createdAt: whatsappMessages.createdAt,
      updatedAt: whatsappMessages.updatedAt,
    })
    .from(whatsappMessages)
    .leftJoin(
      whatsappContacts,
      eq(whatsappContacts.id, whatsappMessages.contactId),
    )
    .where(eq(whatsappMessages.campaignId, campaignId))
    .orderBy(desc(whatsappMessages.createdAt));

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
    template_name: c.templateName,
    template_language: c.templateLanguage,
    variables: c.variables ?? [],
    status: c.status,
    scheduled_at: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    started_at: c.startedAt ? c.startedAt.toISOString() : null,
    completed_at: c.completedAt ? c.completedAt.toISOString() : null,
    created_at: c.createdAt.toISOString(),
    stats,
    recipients: messages.map((m) => ({
      id: m.id,
      phone: m.phone,
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
  template_name: string;
  template_language: string;
  variables?: string[];
  mode?: "draft" | "now" | "schedule";
  scheduled_at?: string | null;
  daily_limit?: number | null;
  header_media_id?: string | null;
  header_media_type?: string | null;
}): Promise<CreateCampaignResult> {
  const audience = await db
    .select({ id: whatsappAudiences.id })
    .from(whatsappAudiences)
    .where(eq(whatsappAudiences.id, input.audience_id))
    .limit(1);
  if (audience.length === 0) return { ok: false, error: "audience_not_found" };

  if (!input.name.trim() || !input.template_name.trim()) {
    return { ok: false, error: "invalid" };
  }

  const mode = input.mode ?? "draft";
  let status = "draft";
  let scheduledAt: Date | null = null;
  let startedAt: Date | null = null;

  if (mode === "schedule") {
    if (!input.scheduled_at) return { ok: false, error: "invalid" };
    scheduledAt = new Date(input.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) return { ok: false, error: "invalid" };
    status = "scheduled";
  } else if (mode === "now") {
    status = "sending";
    startedAt = new Date();
  }

  const [created] = await db
    .insert(whatsappCampaigns)
    .values({
      name: input.name.trim(),
      audienceId: input.audience_id,
      templateName: input.template_name.trim(),
      templateLanguage: input.template_language.trim() || "en_US",
      variables: input.variables ?? [],
      status,
      dailyLimit:
        input.daily_limit != null && input.daily_limit > 0
          ? Math.floor(input.daily_limit)
          : null,
      headerMediaId: input.header_media_id?.trim() || null,
      headerMediaType: ((): string | null => {
        const t = input.header_media_type?.trim().toLowerCase();
        return t === "image" || t === "video" || t === "document" ? t : null;
      })(),
      scheduledAt,
      startedAt,
    })
    .returning({ id: whatsappCampaigns.id });

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
    .select({ id: whatsappCampaigns.id, status: whatsappCampaigns.status })
    .from(whatsappCampaigns)
    .where(eq(whatsappCampaigns.id, campaignId))
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
      .update(whatsappCampaigns)
      .set({ status: "scheduled", scheduledAt: when })
      .where(eq(whatsappCampaigns.id, campaignId));
    return { ok: true };
  }

  await db
    .update(whatsappCampaigns)
    .set({ status: "sending", startedAt: new Date() })
    .where(eq(whatsappCampaigns.id, campaignId));
  void dispatchCampaign(campaignId).catch((err) =>
    logger.error({ err, campaignId }, "Campaign dispatch failed"),
  );
  return { ok: true };
}

/**
 * Manually re-trigger dispatch for a campaign already in `sending`. Used by the
 * admin "Continue broadcast" button to nudge a stalled send. Idempotent and
 * safe to spam: dispatchCampaign holds a per-campaign advisory lock, so if the
 * scheduler (or a prior click) is already dispatching, this call is a no-op.
 * Remaining queued recipients are picked up, still bounded by the daily cap.
 */
export async function resumeCampaign(
  campaignId: string,
): Promise<SendCampaignResult> {
  const [c] = await db
    .select({ id: whatsappCampaigns.id, status: whatsappCampaigns.status })
    .from(whatsappCampaigns)
    .where(eq(whatsappCampaigns.id, campaignId))
    .limit(1);
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "sending") {
    return { ok: false, error: "invalid_state" };
  }
  void dispatchCampaign(campaignId).catch((err) =>
    logger.error({ err, campaignId }, "Campaign resume dispatch failed"),
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sender engine
// ---------------------------------------------------------------------------

function sendDelayMs(): number {
  const raw = Number(process.env.WHATSAPP_SEND_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 250;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Materialize the recipient list for a campaign (eligible audience members that
 * don't already have a message row) and send each template message
 * sequentially with a small throttle. Per-recipient outcomes are persisted so a
 * partial failure never loses progress. Safe to call again (idempotent enqueue
 * + only sends rows still queued).
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
      "SELECT pg_try_advisory_lock(hashtext('whatsapp_dispatch'), hashtext($1)) AS ok",
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
        "SELECT pg_advisory_unlock(hashtext('whatsapp_dispatch'), hashtext($1))",
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
    .from(whatsappCampaigns)
    .where(eq(whatsappCampaigns.id, campaignId))
    .limit(1);
  if (!campaign) return;

  if (campaign.status !== "sending") {
    await db
      .update(whatsappCampaigns)
      .set({ status: "sending", startedAt: campaign.startedAt ?? new Date() })
      .where(eq(whatsappCampaigns.id, campaignId));
  }

  // Eligible audience members (consented, not opted-out).
  const members = await db
    .select({
      contactId: whatsappContacts.id,
      phone: whatsappContacts.phone,
      consent: whatsappContacts.consent,
      optedOut: whatsappContacts.optedOut,
    })
    .from(whatsappAudienceMembers)
    .innerJoin(
      whatsappContacts,
      eq(whatsappContacts.id, whatsappAudienceMembers.contactId),
    )
    .where(eq(whatsappAudienceMembers.audienceId, campaign.audienceId));

  const eligible = members.filter(isEligible);

  // Idempotent enqueue: skip contacts that already have a row for this campaign.
  const existing = await db
    .select({ contactId: whatsappMessages.contactId })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.campaignId, campaignId));
  const existingContacts = new Set(
    existing.map((e) => e.contactId).filter(Boolean) as string[],
  );

  const toEnqueue = eligible.filter((m) => !existingContacts.has(m.contactId));
  if (toEnqueue.length > 0) {
    // onConflictDoNothing against the (campaign_id, contact_id) unique index is
    // the hard guard: two dispatchers racing the same campaign can't double-row
    // a recipient even if both pass the read-based filter above.
    await db
      .insert(whatsappMessages)
      .values(
        toEnqueue.map((m) => ({
          campaignId,
          contactId: m.contactId,
          phone: m.phone,
          status: "queued",
        })),
      )
      .onConflictDoNothing({
        target: [whatsappMessages.campaignId, whatsappMessages.contactId],
      });
  }

  // Send everything still queued. Each row is atomically claimed (queued ->
  // sending) before the provider call, so a concurrent dispatcher that selected
  // the same row loses the race and skips it — guaranteeing exactly one send per
  // recipient. (Same atomic-claim pattern as the instalment charge job.)
  const queued = await db
    .select({ id: whatsappMessages.id, phone: whatsappMessages.phone })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.campaignId, campaignId),
        eq(whatsappMessages.status, "queued"),
      ),
    );

  const configured = isWhatsappConfigured();
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
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.campaignId, campaignId),
          isNotNull(whatsappMessages.sentAt),
          gte(whatsappMessages.sentAt, windowStart),
        ),
      );
    remaining = Math.max(0, campaign.dailyLimit - sentInWindow);
  }

  const headerMedia =
    campaign.headerMediaId && campaign.headerMediaType
      ? {
          type: campaign.headerMediaType as "image" | "video" | "document",
          id: campaign.headerMediaId,
        }
      : null;

  let sentThisRun = 0;
  for (const msg of queued) {
    if (sentThisRun >= remaining) break;
    const claimed = await db
      .update(whatsappMessages)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(whatsappMessages.id, msg.id),
          eq(whatsappMessages.status, "queued"),
        ),
      )
      .returning({ id: whatsappMessages.id });
    if (claimed.length === 0) continue; // another dispatcher already took it

    if (!configured) {
      await db
        .update(whatsappMessages)
        .set({
          status: "failed",
          error: "WhatsApp sender not configured",
          updatedAt: new Date(),
        })
        .where(eq(whatsappMessages.id, msg.id));
      continue;
    }

    const result = await sendTemplateMessage({
      to: msg.phone,
      templateName: campaign.templateName,
      languageCode: campaign.templateLanguage,
      variables: campaign.variables ?? [],
      headerMedia,
    });

    if (result.ok) {
      // Only successful sends count toward the daily cap (matches Meta, which
      // doesn't count failed/undelivered marketing messages against the limit).
      sentThisRun += 1;
      await db
        .update(whatsappMessages)
        .set({
          status: "sent",
          providerMessageId: result.messageId,
          error: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(whatsappMessages.id, msg.id));
    } else {
      await db
        .update(whatsappMessages)
        .set({ status: "failed", error: result.error, updatedAt: new Date() })
        .where(eq(whatsappMessages.id, msg.id));
    }

    if (delay > 0) await sleep(delay);
  }

  // Only complete the campaign once no row is still queued or mid-send, so a
  // concurrent dispatcher that drained 0 rows can't prematurely mark it done
  // while another is still sending.
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.campaignId, campaignId),
        inArray(whatsappMessages.status, ["queued", "sending"]),
      ),
    );
  if (pending === 0) {
    await db
      .update(whatsappCampaigns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(whatsappCampaigns.id, campaignId));
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
    .select({ id: whatsappCampaigns.id })
    .from(whatsappCampaigns)
    .where(
      or(
        and(
          eq(whatsappCampaigns.status, "scheduled"),
          sql`${whatsappCampaigns.scheduledAt} <= ${now}`,
        ),
        eq(whatsappCampaigns.status, "sending"),
      ),
    );

  for (const c of due) {
    await dispatchCampaign(c.id);
  }
  return { dispatched: due.length };
}

// ---------------------------------------------------------------------------
// Inbound webhook processing
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

const STOP_KEYWORDS = new Set([
  "stop",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "stopall",
]);

interface WebhookStatus {
  id?: string;
  status?: string;
  errors?: Array<{ title?: string; message?: string }>;
}

interface WebhookInbound {
  from?: string;
  type?: string;
  text?: { body?: string };
}

interface WebhookValue {
  statuses?: WebhookStatus[];
  messages?: WebhookInbound[];
}

interface WebhookPayload {
  entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }>;
}

/**
 * Apply a verified webhook payload: advance per-message delivery statuses (never
 * downgrading) and opt out contacts who reply STOP. Callers must verify the
 * HMAC signature before invoking this.
 */
export async function processWhatsappWebhook(payload: unknown): Promise<void> {
  const body = payload as WebhookPayload;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses ?? []) {
        logger.info(
          {
            providerMessageId: status.id,
            deliveryStatus: status.status,
            errors: status.errors,
          },
          "WhatsApp delivery status received",
        );
        await applyStatusUpdate(status);
      }

      for (const inbound of value.messages ?? []) {
        await applyInboundMessage(inbound);
      }
    }
  }
}

async function applyStatusUpdate(status: WebhookStatus): Promise<void> {
  if (!status.id || !status.status) return;
  const newStatus = status.status.toLowerCase();

  const [existing] = await db
    .select({
      id: whatsappMessages.id,
      status: whatsappMessages.status,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.providerMessageId, status.id))
    .limit(1);
  if (!existing) return;

  if (newStatus === "failed") {
    const detail =
      status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? "failed";
    await db
      .update(whatsappMessages)
      .set({ status: "failed", error: detail, updatedAt: new Date() })
      .where(eq(whatsappMessages.id, existing.id));
    return;
  }

  // Only advance forward; never downgrade (read -> delivered is ignored).
  const currentRank = STATUS_RANK[existing.status] ?? -1;
  const nextRank = STATUS_RANK[newStatus] ?? -1;
  if (nextRank > currentRank) {
    await db
      .update(whatsappMessages)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(whatsappMessages.id, existing.id));
  }
}

async function applyInboundMessage(inbound: WebhookInbound): Promise<void> {
  if (!inbound.from) return;

  // Meta sends `from` as digits without a leading '+'. Our contacts are E.164.
  const phone = inbound.from.startsWith("+") ? inbound.from : `+${inbound.from}`;

  const rawText = inbound.text?.body ?? "";
  const normalizedText = rawText.trim().toLowerCase();

  // STOP keyword handling — must still opt the contact out as before.
  if (normalizedText) {
    const firstWord = normalizedText.split(/\s+/)[0];
    if (STOP_KEYWORDS.has(firstWord)) {
      await optOutByPhone(phone);
    }
  }

  // Resolve an existing WhatsApp contact so the inbox can link to it.
  const [contact] = await db
    .select({ id: whatsappContacts.id, name: whatsappContacts.name })
    .from(whatsappContacts)
    .where(eq(whatsappContacts.phone, phone))
    .limit(1);

  // Only record text messages (type === "text" or no type). Media-only
  // messages (image, audio, video, document, sticker) are noted but body is
  // left empty; we flag hasMedia so staff can see something arrived.
  const isMedia =
    !!inbound.type &&
    inbound.type !== "text" &&
    inbound.type !== "button" &&
    inbound.type !== "interactive";

  const body = rawText.slice(0, 10_000);

  await db.insert(inboundMessages).values({
    channel: "whatsapp",
    sender: phone,
    displayName: contact?.name ?? null,
    body,
    hasMedia: isMedia,
    contactId: contact?.id ?? null,
    read: false,
    receivedAt: new Date(),
  });
}
