import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  bigint,
  index,
} from "drizzle-orm/pg-core";

export const groupOrders = pgTable("group_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: text("mode").notNull(),
  organiserName: text("organiser_name").notNull(),
  organiserEmail: text("organiser_email").notNull(),
  status: text("status").notNull().default("open"),
  splitApartmentType: text("split_apartment_type"),
  splitNights: integer("split_nights"),
  splitVoucherCode: text("split_voucher_code"),
  currency: text("currency").notNull().default("SCR"),
  dueBy: timestamp("due_by", { withTimezone: true }),
  statusToken: text("status_token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const voucherLines = pgTable(
  "voucher_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupOrderId: uuid("group_order_id")
      .notNull()
      .references(() => groupOrders.id, { onDelete: "cascade" }),
    apartmentType: text("apartment_type"),
    nights: integer("nights"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    payerName: text("payer_name").notNull(),
    payerEmail: text("payer_email").notNull(),
    payToken: text("pay_token").notNull().unique(),
    status: text("status").notNull().default("pending"),
    stripeSessionId: text("stripe_session_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voucherCode: text("voucher_code"),
    creditCode: text("credit_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_voucher_line_order").on(table.groupOrderId),
    index("idx_voucher_line_status").on(table.status),
    index("idx_voucher_line_paytok").on(table.payToken),
  ],
);

export type GroupOrder = typeof groupOrders.$inferSelect;
export type VoucherLine = typeof voucherLines.$inferSelect;
