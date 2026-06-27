import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

/**
 * WhatsApp marketing contacts. Numbers are stored normalized to E.164 and are
 * unique. Marketing is opt-in and STOP-aware: `consent` records how the contact
 * was acquired (first-party uploads default to `opted_in`), and `optedOut` is a
 * hard exclusion flag flipped either manually by staff or automatically by an
 * inbound STOP reply processed from the Cloud API webhook. A contact is only
 * eligible for a send when `consent = 'opted_in'` AND `optedOut = false`.
 */
export const whatsappContacts = pgTable(
  "whatsapp_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull().unique(),
    name: text("name"),
    consent: text("consent").notNull().default("opted_in"),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    source: text("source").notNull().default("import"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_whatsapp_contact_opted_out").on(table.optedOut)],
);

/** Named, staff-managed segments contacts can belong to. */
export const whatsappAudiences = pgTable("whatsapp_audience", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Many-to-many membership between contacts and audiences. */
export const whatsappAudienceMembers = pgTable(
  "whatsapp_audience_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => whatsappAudiences.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => whatsappContacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_whatsapp_audience_member").on(table.audienceId, table.contactId),
    index("idx_whatsapp_audience_member_audience").on(table.audienceId),
  ],
);

/**
 * A marketing campaign: an approved Meta template + filled body variables sent
 * to one audience. `variables` is the ordered list of {{1}}..{{n}} body values.
 * Status flow: draft -> scheduled|sending -> completed (or failed).
 */
export const whatsappCampaigns = pgTable(
  "whatsapp_campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => whatsappAudiences.id, { onDelete: "restrict" }),
    templateName: text("template_name").notNull(),
    templateLanguage: text("template_language").notNull().default("en_US"),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_whatsapp_campaign_status").on(table.status)],
);

/**
 * One row per recipient of a campaign. `status` advances queued -> sent ->
 * delivered -> read (or -> failed) as the Cloud API webhook reports back, keyed
 * by `providerMessageId` (the wamid returned at send time).
 */
export const whatsappMessages = pgTable(
  "whatsapp_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => whatsappCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => whatsappContacts.id, {
      onDelete: "set null",
    }),
    phone: text("phone").notNull(),
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
    unique("uq_whatsapp_message_campaign_contact").on(
      table.campaignId,
      table.contactId,
    ),
    index("idx_whatsapp_message_campaign").on(table.campaignId),
    index("idx_whatsapp_message_provider").on(table.providerMessageId),
  ],
);

export type WhatsappContact = typeof whatsappContacts.$inferSelect;
export type WhatsappAudience = typeof whatsappAudiences.$inferSelect;
export type WhatsappAudienceMember =
  typeof whatsappAudienceMembers.$inferSelect;
export type WhatsappCampaign = typeof whatsappCampaigns.$inferSelect;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
