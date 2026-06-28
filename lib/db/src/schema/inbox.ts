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
 * Messages exchanged with customers via WhatsApp or email. Inbound messages
 * arrive via WhatsApp replies or SendGrid Inbound Parse; outbound messages are
 * replies sent by staff from the admin inbox.
 *
 * channel: "whatsapp" | "email"
 * direction: "inbound" (from customer) | "outbound" (staff reply)
 * sender: the customer's address for the thread — E.164 phone for WhatsApp,
 *   email address for email. Outbound replies share the same value so they
 *   group into the same thread as the customer's inbound messages.
 * displayName: contact name if known (WA contact name / email From: name)
 * subject: email subject only
 * body: plain-text body (truncated at 10 000 chars)
 * providerMessageId: WhatsApp wamid or SendGrid message-id, for dedup
 * hasMedia: true when the inbound had an attachment/media (not stored)
 * contactId: FK to whatsapp_contact when the sender is a known WA contact
 * read: false until a staff member marks it read (outbound rows are read)
 * sentByEmail: staff email that sent an outbound reply (null for inbound)
 */
export const inboundMessages = pgTable(
  "inbound_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel").notNull(),
    direction: text("direction").notNull().default("inbound"),
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
    sentByEmail: text("sent_by_email"),
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
