import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  jsonb,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Corporate lunch buffet requests submitted from the public `/corporate-lunch`
 * menu builder. The price is recomputed server-side at submission and frozen
 * here, so later pricing changes never alter a request already sent. Staff
 * confirm or decline from the admin dashboard; nothing is charged online.
 */
export const corporateLunchRequests = pgTable(
  "corporate_lunch_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-readable reference shown to the client, e.g. SB-7FK3-Q9WX. */
    reference: text("reference").notNull().unique(),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    /** E.164 when it parsed, else as typed. */
    phone: text("phone").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    guests: integer("guests").notNull(),
    /** Dish ids by course: { starters: [...], mains: [...], rice: [...], desserts: [...] }. */
    selection: jsonb("selection").$type<Record<string, string[]>>().notNull(),
    /** Extra dishes and their price per person at the time of the request. */
    extras: jsonb("extras")
      .$type<{ dishId: string; name: string; pricePerPerson: number }[]>()
      .notNull()
      .default([]),
    pricePerPerson: integer("price_per_person").notNull(),
    total: integer("total").notNull(),
    /** Internal: estimated food + wine + consumables cost per person (SCR). */
    costPerPerson: numeric("cost_per_person", { precision: 10, scale: 2, mode: "number" }).notNull(),
    notes: text("notes"),
    /** new | confirmed | declined | cancelled */
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_corporate_lunch_request_event_date").on(t.eventDate)],
);

export type CorporateLunchRequest = typeof corporateLunchRequests.$inferSelect;
