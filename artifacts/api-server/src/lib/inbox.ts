import { and, desc, eq, sql } from "drizzle-orm";
import { db, inboundMessages } from "@workspace/db";
import { sendTextMessage } from "./whatsappClient";
import { sendEmail } from "./sendgridClient";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InboxQueryParams {
  channel?: "whatsapp" | "email";
  unread_only?: boolean;
}

export interface InboxMessageRow {
  id: string;
  channel: string;
  direction: string;
  sender: string;
  display_name: string | null;
  subject: string | null;
  body: string;
  has_media: boolean;
  contact_id: string | null;
  read: boolean;
  sent_by_email: string | null;
  received_at: string;
}

export interface InboxThread {
  channel: string;
  sender: string;
  display_name: string | null;
  unread_count: number;
  last_received_at: string;
  messages: InboxMessageRow[];
}

export interface InboxResult {
  threads: InboxThread[];
  total_unread: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toMessageRow(row: typeof inboundMessages.$inferSelect): InboxMessageRow {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    sender: row.sender,
    display_name: row.displayName,
    subject: row.subject,
    body: row.body,
    has_media: row.hasMedia,
    contact_id: row.contactId,
    read: row.read,
    sent_by_email: row.sentByEmail,
    received_at: row.receivedAt.toISOString(),
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Return all messages grouped into threads (one thread per sender), newest
 * thread first. Applies optional channel and unread-only filters.
 */
export async function getInbox(params: InboxQueryParams): Promise<InboxResult> {
  const conditions = [];
  if (params.channel) {
    conditions.push(eq(inboundMessages.channel, params.channel));
  }
  if (params.unread_only) {
    conditions.push(eq(inboundMessages.read, false));
  }

  const rows = await db
    .select()
    .from(inboundMessages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(inboundMessages.receivedAt));

  // Group by sender in JS (avoids complex SQL grouping while keeping
  // message-level detail within each thread).
  const threadMap = new Map<string, InboxThread>();
  for (const row of rows) {
    const key = `${row.channel}::${row.sender}`;
    if (!threadMap.has(key)) {
      threadMap.set(key, {
        channel: row.channel,
        sender: row.sender,
        display_name: row.displayName,
        unread_count: 0,
        last_received_at: row.receivedAt.toISOString(),
        messages: [],
      });
    }
    const thread = threadMap.get(key)!;
    thread.messages.push(toMessageRow(row));
    if (!row.read) thread.unread_count++;
    // Keep display_name up-to-date (use the most recent non-null one).
    if (row.displayName && !thread.display_name) {
      thread.display_name = row.displayName;
    }
  }

  const threads = Array.from(threadMap.values());
  // Sort threads by the latest message (already desc within each thread, but
  // insertion order may not match across threads).
  threads.sort(
    (a, b) =>
      new Date(b.last_received_at).getTime() -
      new Date(a.last_received_at).getTime(),
  );

  const total_unread = threads.reduce((sum, t) => sum + t.unread_count, 0);

  return { threads, total_unread };
}

export async function getUnreadCount(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inboundMessages)
    .where(eq(inboundMessages.read, false));
  return result?.count ?? 0;
}

export async function markMessageRead(
  messageId: string,
  read: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(inboundMessages)
    .set({ read })
    .where(eq(inboundMessages.id, messageId))
    .returning({ id: inboundMessages.id });
  return !!updated;
}

export async function markThreadRead(
  sender: string,
  read: boolean,
): Promise<void> {
  await db
    .update(inboundMessages)
    .set({ read })
    .where(eq(inboundMessages.sender, sender));
}

// ─── Email save (called from the SendGrid webhook route) ─────────────────────

export interface SaveEmailInput {
  sender: string;
  displayName: string | null;
  subject: string | null;
  body: string;
  hasMedia: boolean;
}

export async function saveEmailMessage(input: SaveEmailInput): Promise<void> {
  await db.insert(inboundMessages).values({
    channel: "email",
    direction: "inbound",
    sender: input.sender,
    displayName: input.displayName,
    subject: input.subject,
    body: input.body,
    hasMedia: input.hasMedia,
    read: false,
    receivedAt: new Date(),
  });
}

// ─── Reply (outbound) ────────────────────────────────────────────────────────

export interface SendReplyInput {
  channel: "whatsapp" | "email";
  /** The customer's address — E.164 phone (WhatsApp) or email (email). */
  sender: string;
  body: string;
  /** Email subject. Optional; ignored for WhatsApp. */
  subject?: string | null;
  /** The staff member sending the reply, recorded on the outbound row. */
  staffEmail: string;
}

export type SendReplyResult =
  | { ok: true; message: InboxMessageRow }
  | { ok: false; error: string };

/**
 * Send a staff reply to a customer over the thread's channel and record it as an
 * outbound message so it appears alongside the inbound ones. The send happens
 * first; the row is only persisted once the provider accepts it, so a failed
 * send never leaves a phantom "sent" message in the thread.
 */
export async function sendReply(
  input: SendReplyInput,
): Promise<SendReplyResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Message body is required." };

  // Carry the most recent display name onto the outbound row so the thread stays
  // labelled even if it only ever contained inbound messages before.
  const [latest] = await db
    .select({ displayName: inboundMessages.displayName, contactId: inboundMessages.contactId })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.channel, input.channel),
        eq(inboundMessages.sender, input.sender),
      ),
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(1);

  if (input.channel === "whatsapp") {
    const result = await sendTextMessage({ to: input.sender, body });
    if (!result.ok) {
      const error =
        result.error === "not_configured"
          ? "WhatsApp is not configured."
          : `WhatsApp send failed: ${result.error}`;
      return { ok: false, error };
    }
  } else {
    const subject = (input.subject ?? "").trim() || "Re: your message";
    const html = body
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
    try {
      await sendEmail({ to: input.sender, subject, text: body, html });
    } catch (err) {
      return {
        ok: false,
        error: `Email send failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const [row] = await db
    .insert(inboundMessages)
    .values({
      channel: input.channel,
      direction: "outbound",
      sender: input.sender,
      displayName: latest?.displayName ?? null,
      subject: input.channel === "email" ? (input.subject ?? null) : null,
      body,
      hasMedia: false,
      contactId: latest?.contactId ?? null,
      // Outbound replies are inherently "read" — staff just sent them.
      read: true,
      sentByEmail: input.staffEmail,
      receivedAt: new Date(),
    })
    .returning();

  return { ok: true, message: toMessageRow(row) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
