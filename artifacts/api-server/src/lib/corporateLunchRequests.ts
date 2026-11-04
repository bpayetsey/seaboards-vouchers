import { desc, eq } from "drizzle-orm";
import {
  db,
  corporateLunchRequests,
  newOrderNumber,
  type CorporateLunchRequest,
} from "@workspace/db";
import {
  CORPORATE_LUNCH,
  CORPORATE_LUNCH_COURSES,
  RESORT,
  findCorporateLunchDish,
} from "@workspace/voucher-content";
import { logger } from "./logger";
import { sendEmail } from "./sendgridClient";
import { normalizePhone } from "./phone";
import {
  CORPORATE_LUNCH_PRICING,
  CorporateLunchInputError,
  normaliseSelection,
  quoteCorporateLunch,
  type CorporateLunchQuote,
} from "./corporateLunch";

export const CORPORATE_LUNCH_STATUSES = ["new", "confirmed", "declined", "cancelled"] as const;
export type CorporateLunchStatus = (typeof CORPORATE_LUNCH_STATUSES)[number];

/** snake_case quote for the API. */
export function quoteToApi(q: CorporateLunchQuote) {
  return {
    complete: q.complete,
    issues: q.issues,
    guests: q.guests,
    set_menu_per_person: q.setMenuPerPerson,
    extras_per_person: q.extrasPerPerson,
    small_group_fee_per_person: q.smallGroupFeePerPerson,
    price_per_person: q.pricePerPerson,
    total: q.total,
    extras: q.extras.map((e) => ({ dish_id: e.dishId, name: e.name, price_per_person: e.pricePerPerson })),
    currency: CORPORATE_LUNCH.currency,
  };
}

export interface NewCorporateLunchRequest {
  guests: number;
  selection: unknown;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  eventDate: string;
  notes?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in the resort's timezone, as YYYY-MM-DD. */
function todayInMahe(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Mahe" }).format(new Date());
}

/**
 * Validates, re-prices and stores a request. Throws CorporateLunchInputError
 * with a client-safe message on bad input.
 */
export async function createCorporateLunchRequest(input: NewCorporateLunchRequest): Promise<{
  request: CorporateLunchRequest;
  quote: CorporateLunchQuote;
}> {
  const company = input.company.trim();
  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();
  const notes = input.notes?.trim() || null;
  if (!company || company.length > 200) throw new CorporateLunchInputError("Enter your company name.");
  if (!contactName || contactName.length > 200) throw new CorporateLunchInputError("Enter a contact name.");
  if (!EMAIL_RE.test(email) || email.length > 254) throw new CorporateLunchInputError("Enter a valid email address.");
  if (notes && notes.length > 2000) throw new CorporateLunchInputError("Notes are limited to 2,000 characters.");
  if (!DATE_RE.test(input.eventDate) || Number.isNaN(Date.parse(input.eventDate))) {
    throw new CorporateLunchInputError("Choose the date of your lunch.");
  }
  if (input.eventDate <= todayInMahe()) {
    throw new CorporateLunchInputError("Choose a date from tomorrow onwards.");
  }
  const phoneResult = normalizePhone(input.phone, "SC");
  if (!phoneResult.ok) throw new CorporateLunchInputError("Enter a valid phone number.");

  const selection = normaliseSelection(input.selection);
  const { quote, costing } = quoteCorporateLunch(selection, input.guests);
  if (!quote.complete) throw new CorporateLunchInputError(quote.issues.join(" "));

  const [request] = await db
    .insert(corporateLunchRequests)
    .values({
      reference: newOrderNumber(),
      company,
      contactName,
      email,
      phone: phoneResult.e164,
      eventDate: input.eventDate,
      guests: quote.guests,
      selection,
      extras: quote.extras,
      pricePerPerson: quote.pricePerPerson,
      total: quote.total,
      costPerPerson: costing.totalCostPerPerson,
      notes,
    })
    .returning();

  void notify(request!, quote);
  return { request: request!, quote };
}

export async function listCorporateLunchRequests() {
  const rows = await db
    .select()
    .from(corporateLunchRequests)
    .orderBy(desc(corporateLunchRequests.eventDate), desc(corporateLunchRequests.createdAt));
  return rows.map(toAdmin);
}

export async function setCorporateLunchStatus(id: string, status: CorporateLunchStatus) {
  const [row] = await db
    .update(corporateLunchRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(corporateLunchRequests.id, id))
    .returning();
  return row ? toAdmin(row) : null;
}

function dishesByCourse(selection: Record<string, string[]>) {
  return CORPORATE_LUNCH_COURSES.map((course) => ({
    course: course.name,
    names: (selection[course.id] ?? []).map((id) => findCorporateLunchDish(id)?.dish.name ?? id),
  }));
}

function toAdmin(r: CorporateLunchRequest) {
  const labour = CORPORATE_LUNCH_PRICING.labourPerEvent;
  const profit = r.total - r.costPerPerson * r.guests - labour;
  return {
    id: r.id,
    reference: r.reference,
    company: r.company,
    contact_name: r.contactName,
    email: r.email,
    phone: r.phone,
    event_date: r.eventDate,
    guests: r.guests,
    dishes: dishesByCourse(r.selection),
    extras: r.extras.map((e) => ({ dish_id: e.dishId, name: e.name, price_per_person: e.pricePerPerson })),
    price_per_person: r.pricePerPerson,
    total: r.total,
    cost_per_person: r.costPerPerson,
    labour,
    profit: Math.round(profit * 100) / 100,
    margin: r.total > 0 ? Math.round((profit / r.total) * 1000) / 1000 : 0,
    notes: r.notes,
    status: r.status,
    created_at: r.createdAt.toISOString(),
  };
}

// ── Emails (best-effort; a failed send never fails the request) ──────────────

const scr = (n: number) => `SCR ${Math.round(n).toLocaleString("en-US")}`;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function formatDate(d: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Indian/Mahe",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${d}T12:00:00+04:00`));
  } catch {
    return d;
  }
}

function summaryLines(r: CorporateLunchRequest, q: CorporateLunchQuote): string[] {
  return [
    `Reference: ${r.reference}`,
    `Company: ${r.company}`,
    `Contact: ${r.contactName} · ${r.phone} · ${r.email}`,
    `Date: ${formatDate(r.eventDate)}, ${CORPORATE_LUNCH.service.replace(/^Buffet lunch, /, "")}`,
    `Guests: ${r.guests}`,
    "",
    ...dishesByCourse(r.selection).map((c) => `${c.course}: ${c.names.join(", ") || "—"}`),
    q.extras.length
      ? `Extras: ${q.extras.map((e) => `${e.name} (+${scr(e.pricePerPerson)})`).join(", ")} per person`
      : "Extras: none",
    `Included: ${CORPORATE_LUNCH.inclusions.join(", ")}`,
    "",
    `Price: ${scr(q.pricePerPerson)} per person`,
    `Total: ${scr(q.total)} for ${r.guests} guests`,
    ...(r.notes ? ["", `Notes: ${r.notes}`] : []),
  ];
}

function shell(heading: string, lines: string[], lead: string): string {
  const body = lines
    .map((l) => (l === "" ? "<br>" : `<div style="margin:2px 0;">${esc(l)}</div>`))
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#F5F1E8;font-family:Georgia,'Times New Roman',serif;color:#1D2622;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#FBF9F4;border:1px solid #DCD5C6;padding:28px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8A6D40;font-weight:bold;">${esc(RESORT.name)}</div>
      <h1 style="margin:8px 0 12px;font-size:22px;color:#22392F;">${esc(heading)}</h1>
      <p style="margin:0 0 16px;font-size:15px;">${esc(lead)}</p>
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">${body}</div>
    </div>
    <p style="text-align:center;color:#5A6660;font-size:12px;margin-top:20px;">${esc(RESORT.name)} · ${esc(RESORT.location)} · ${esc(RESORT.reservationsPhone)}</p>
  </div></body></html>`;
}

function staffRecipients(): string[] {
  const raw = process.env.CORPORATE_LUNCH_NOTIFY_EMAILS || process.env.STAFF_EMAILS || "";
  return raw
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

async function notify(r: CorporateLunchRequest, q: CorporateLunchQuote): Promise<void> {
  const lines = summaryLines(r, q);
  const jobs: Promise<unknown>[] = [
    sendEmail({
      to: r.email,
      subject: `Your corporate lunch request ${r.reference} — ${RESORT.name}`,
      text: [
        `Thank you, ${r.contactName}. We've received your corporate lunch request and will confirm availability shortly.`,
        "",
        ...lines,
        "",
        `Questions? Call or WhatsApp ${RESORT.reservationsPhone}.`,
      ].join("\n"),
      html: shell(
        "We've received your request",
        lines,
        `Thank you, ${r.contactName}. We'll confirm availability shortly. Questions? Call or WhatsApp ${RESORT.reservationsPhone}.`,
      ),
    }),
    ...staffRecipients().map((to) =>
      sendEmail({
        to,
        subject: `New corporate lunch request: ${r.company}, ${r.guests} guests, ${r.eventDate}`,
        text: lines.join("\n"),
        html: shell("New corporate lunch request", lines, "Confirm or decline it in the admin dashboard under Corporate Lunch."),
      }),
    ),
  ];
  const results = await Promise.allSettled(jobs);
  for (const res of results) {
    if (res.status === "rejected") {
      logger.warn({ err: res.reason, reference: r.reference }, "Corporate lunch email not sent");
    }
  }
}
