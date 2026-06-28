import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  index,
  primaryKey,
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
    // Day-pass booking intent captured at checkout, materialised into a
    // day_pass_booking row on the first successful payment. `dayPassPax` is the
    // server-validated party size (adults + children); `dayPassVisitDate` is the
    // requested visit day (null = undated / decide later).
    dayPassPax: integer("day_pass_pax"),
    dayPassVisitDate: date("day_pass_visit_date", { mode: "string" }),
    // Account credit applied at checkout, in minor units. The cash actually
    // charged (via Stripe) is `totalMinor - creditAppliedMinor`; `totalMinor`
    // stays the full product price so the issued voucher carries full value.
    creditAppliedMinor: bigint("credit_applied_minor", { mode: "number" })
      .notNull()
      .default(0),
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
    // Idempotency claim for the per-instalment payment receipt email. Set the
    // first time the receipt is emailed (whether the instalment was finalised by
    // the daily charge job's webhook or a client's advance payment), so the two
    // paths never double-send.
    receiptEmailedAt: timestamp("receipt_emailed_at", { withTimezone: true }),
    // Idempotency claims for the instalment-lifecycle notices ("payment failed"
    // and "action required"). Set the first time each notice is emailed for this
    // instalment so a retrying charge job (daily job, advance pay, or staff
    // retry) never re-emails on every run; on a delivery failure the claim is
    // released so a later attempt can re-send.
    failedEmailedAt: timestamp("failed_emailed_at", { withTimezone: true }),
    actionRequiredEmailedAt: timestamp("action_required_emailed_at", {
      withTimezone: true,
    }),
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

/**
 * Privacy-preserving page-view log for the in-house site visitor counter.
 * Each row is one public page view: the normalized path, a salted day-bucketed
 * visitor hash (HMAC of IP + user agent with a daily-rotating salt — never the
 * raw IP), and a timestamp. No PII or tracking cookies are involved; the hash
 * cannot be reversed to an IP and rotates every day so it is not a stable
 * cross-day identifier.
 */
export const pageViews = pgTable(
  "page_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    path: text("path").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_page_view_created").on(table.createdAt),
    index("idx_page_view_visitor").on(table.visitorHash),
  ],
);

/**
 * A day-pass visit booking. One row per day-pass order (created on the first
 * successful payment). `visitDate` null means undated (bought as a gift or
 * "decide later") — the guest assigns a date from their dashboard. Daily
 * capacity is counted as the sum of `pax` across non-cancelled bookings on a
 * given `visitDate`. `rescheduleCount` enforces the free-reschedule cap (max 2).
 */
export const dayPassBookings = pgTable(
  "day_pass_booking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => storeOrders.id, { onDelete: "cascade" }),
    // The verified account email the booking is scoped to (lowercased buyer
    // email). Self-service actions only ever match the authenticated owner.
    email: text("email").notNull(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    // Party size (adults + children) — server-validated, never client-supplied.
    pax: integer("pax").notNull(),
    visitDate: date("visit_date", { mode: "string" }),
    // booked | cancelled
    status: text("status").notNull().default("booked"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_day_pass_booking_email").on(table.email),
    index("idx_day_pass_booking_date").on(table.visitDate, table.status),
  ],
);

/**
 * Admin-blockable calendar days. A day with a row here is closed for day-pass
 * bookings regardless of capacity (e.g. private events, maintenance). Tuesdays
 * are always closed by rule and do not need a row.
 */
export const dayPassBlockedDates = pgTable("day_pass_blocked_date", {
  date: date("date", { mode: "string" }).primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-account credit balance, keyed by (email, currency). Source of truth for
 * spend: a conditional decrement (… WHERE balance_minor >= amount) makes
 * concurrent spends safe (no double-spend). The ledger below records history.
 */
export const accountCreditBalances = pgTable(
  "account_credit_balance",
  {
    email: text("email").notNull(),
    currency: text("currency").notNull(),
    balanceMinor: bigint("balance_minor", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.currency] }),
  ],
);

/**
 * Append-only audit ledger of credit movements. Positive `amountMinor` = credit
 * added (e.g. cancellation), negative = credit spent at checkout.
 */
export const accountCreditEntries = pgTable(
  "account_credit_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    orderId: uuid("order_id"),
    bookingId: uuid("booking_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_account_credit_entry_email").on(table.email)],
);

export type DayPassBooking = typeof dayPassBookings.$inferSelect;
export type DayPassBlockedDate = typeof dayPassBlockedDates.$inferSelect;
export type AccountCreditBalance = typeof accountCreditBalances.$inferSelect;
export type AccountCreditEntry = typeof accountCreditEntries.$inferSelect;

export type StoreOrder = typeof storeOrders.$inferSelect;
export type StoreInstallment = typeof storeInstallments.$inferSelect;
export type StoreVoucher = typeof storeVouchers.$inferSelect;
export type StoreGalleryImage = typeof storeGalleryImages.$inferSelect;
export type StoreCatalogPrice = typeof storeCatalogPrices.$inferSelect;
export type PageView = typeof pageViews.$inferSelect;
