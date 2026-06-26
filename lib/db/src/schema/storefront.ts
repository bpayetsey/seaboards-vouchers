import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Direct-to-buyer storefront orders. Separate from the group-ordering flow
 * (group_order / voucher_line). These power the "Pay in 3" instalment engine:
 * instalment 1 is charged today and the card is saved; a daily job charges the
 * rest off-session.
 */
export const storeOrders = pgTable(
  "store_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Human-readable, unique order reference shown to buyers. Nullable so the
    // additive migration applies cleanly; generated at creation and backfilled.
    orderNumber: text("order_number").unique(),
    productId: text("product_id"),
    productName: text("product_name").notNull(),
    type: text("type").notNull().default("package"),
    buyerName: text("buyer_name").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    currency: text("currency").notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    installments: integer("installments").notNull().default(1),
    paidInstalments: integer("paid_instalments").notNull().default(0),
    status: text("status").notNull().default("pending"),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePaymentMethodId: text("stripe_payment_method_id"),
    firstPaymentIntentId: text("first_payment_intent_id"),
    firstReceiptUrl: text("first_receipt_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_store_order_status").on(table.status)],
);

export const storeInstallments = pgTable(
  "store_installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => storeOrders.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    paymentIntentId: text("payment_intent_id"),
    receiptUrl: text("receipt_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_store_installment_order").on(table.orderId),
    index("idx_store_installment_due").on(table.status, table.dueAt),
  ],
);

export const storeVouchers = pgTable("store_voucher", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: vouchers issued manually by staff have no originating order.
  orderId: uuid("order_id")
    .unique()
    .references(() => storeOrders.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  valueMinor: bigint("value_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  // Idempotency claim for the deposit ("plan started") notice sent on the first
  // Pay-in-3 payment, so it is never sent twice across webhook + confirm retries.
  pendingEmailedAt: timestamp("pending_emailed_at", { withTimezone: true }),
  // Set the first time the issued voucher PDF is emailed to the buyer (the
  // fully-paid "active" milestone). Idempotency claim so webhook retries /
  // confirm fallbacks never re-send.
  voucherEmailedAt: timestamp("voucher_emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Property photo gallery shown on the storefront ("A glimpse of The
 * Seaboards"). Managed by staff from the admin dashboard: images are uploaded
 * to object storage and referenced here by their object path.
 */
export const storeGalleryImages = pgTable(
  "store_gallery_image",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectPath: text("object_path").notNull(),
    alt: text("alt").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_store_gallery_sort").on(table.active, table.sortOrder)],
);

/**
 * Staff-editable price overrides for storefront catalog items, keyed by the
 * catalog item id (e.g. "one-bedroom"). When a row exists it overrides the
 * built-in default rate/was for that item across the storefront and the group
 * split pricing, so prices stay in one place and can be edited from the admin.
 * Values are whole-currency major units (the same representation the catalog
 * uses), matching the resort's SCR pricing.
 */
export const storeCatalogPrices = pgTable("store_catalog_price", {
  itemId: text("item_id").primaryKey(),
  rate: integer("rate").notNull(),
  was: integer("was").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StoreOrder = typeof storeOrders.$inferSelect;
export type StoreInstallment = typeof storeInstallments.$inferSelect;
export type StoreVoucher = typeof storeVouchers.$inferSelect;
export type StoreGalleryImage = typeof storeGalleryImages.$inferSelect;
export type StoreCatalogPrice = typeof storeCatalogPrices.$inferSelect;
