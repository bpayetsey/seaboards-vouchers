import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Email marketing contacts. Addresses are stored normalized (trimmed,
 * lowercased) and are unique. Marketing is opt-in and unsubscribe-aware:
 * `consent` records how the contact was acquired (first-party uploads default
 * to `opted_in`), and `optedOut` is a hard exclusion flag flipped either
 * manually by staff or automatically when the contact clicks the one-click
 * unsubscribe link. A contact is only eligible for a send when
 * `consent = 'opted_in'` AND `optedOut = false`. `unsubscribeToken` is an
 * unguessable per-contact secret embedded in every send's unsubscribe link.
 */
export const emailContacts = pgTable(
  "email_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    consent: text("consent").notNull().default("opted_in"),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    source: text("source").notNull().default("import"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_email_contact_opted_out").on(table.optedOut)],
);

/** Named, staff-managed segments contacts can belong to. */
export const emailAudiences = pgTable("email_audience", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Many-to-many membership between contacts and audiences. */
export const emailAudienceMembers = pgTable(
  "email_audience_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => emailAudiences.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => emailContacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_email_audience_member").on(table.audienceId, table.contactId),
    index("idx_email_audience_member_audience").on(table.audienceId),
  ],
);

/**
 * A marketing email campaign: a subject + body broadcast to one audience.
 * `body` may contain positional `{{1}}..{{n}}` placeholders (filled from
 * `variables`) and the named `{{name}}` placeholder (filled per recipient).
 * Status flow: draft -> scheduled|sending -> completed (or failed).
 */
export const emailCampaigns = pgTable(
  "email_campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => emailAudiences.id, { onDelete: "restrict" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    // Max messages successfully sent per rolling 24h window. NULL = no cap (send
    // the whole audience in one run). When set, dispatchCampaign sends only up to
    // the remaining headroom and leaves the rest queued for the next daily run.
    dailyLimit: integer("daily_limit"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_email_campaign_status").on(table.status)],
);

/**
 * One row per recipient of a campaign. `status` advances queued -> sent ->
 * delivered -> opened (or -> failed) as the SendGrid Event Webhook reports back,
 * keyed by `providerMessageId` (the X-Message-Id returned at send time).
 */
export const emailMessages = pgTable(
  "email_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => emailContacts.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    status: text("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Hard dedupe: at most one message row per (campaign, contact) so concurrent
    // enqueues (duplicate scheduler ticks, send racing the backstop) can never
    // create two rows for the same recipient. contact_id may be NULL only after
    // a contact is deleted (set null), and NULLs are distinct so orphans are fine.
    unique("uq_email_message_campaign_contact").on(
      table.campaignId,
      table.contactId,
    ),
    index("idx_email_message_campaign").on(table.campaignId),
    index("idx_email_message_provider").on(table.providerMessageId),
  ],
);

export type EmailContact = typeof emailContacts.$inferSelect;
export type EmailAudience = typeof emailAudiences.$inferSelect;
export type EmailAudienceMember = typeof emailAudienceMembers.$inferSelect;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
