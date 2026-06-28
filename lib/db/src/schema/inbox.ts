import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { whatsappContacts } from "./whatsapp";

/**
 * Inbound messages received via WhatsApp replies or SendGrid Inbound Parse.
 * This is a read-only log for staff — replies are not sent from this table.
 *
 * channel: "whatsapp" | "email"
 * sender: E.164 phone for WhatsApp, email address for email
 * displayName: contact name if known (WA contact name / email From: name)
 * subject: email subject only
 * body: plain-text body (truncated at 10 000 chars)
 * providerMessageId: WhatsApp wamid or SendGrid message-id, for dedup
 * hasMedia: true when the inbound had an attachment/media (not stored)
 * contactId: FK to whatsapp_contact when the sender is a known WA contact
 * read: false until a staff member marks it read
 */
export const inboundMessages = pgTable(
  "inbound_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel").notNull(),
    sender: text("sender").notNull(),
    displayName: text("display_name"),
    subject: text("subject"),
    body: text("body").notNull().default(""),
    providerMessageId: text("provider_message_id"),
    hasMedia: boolean("has_media").notNull().default(false),
    contactId: uuid("contact_id").references(() => whatsappContacts.id, {
      onDelete: "set null",
    }),
    read: boolean("read").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_inbound_message_channel").on(table.channel),
    index("idx_inbound_message_sender").on(table.sender),
    index("idx_inbound_message_read").on(table.read),
    index("idx_inbound_message_received_at").on(table.receivedAt),
    index("idx_inbound_message_contact").on(table.contactId),
  ],
);

export type InboundMessage = typeof inboundMessages.$inferSelect;
