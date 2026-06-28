import { Router, type IRouter } from "express";
import multer from "multer";
import crypto from "node:crypto";
import {
  GetAdminInboxQueryParams,
  GetAdminInboxResponse,
  GetAdminInboxUnreadCountResponse,
  MarkMessageReadParams,
  MarkMessageReadBody,
  MarkMessageReadResponse,
  MarkThreadReadParams,
  MarkThreadReadBody,
  MarkThreadReadResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/requireStaff";
import {
  getInbox,
  getUnreadCount,
  markMessageRead,
  markThreadRead,
  saveEmailMessage,
} from "../lib/inbox";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Admin inbox routes (Clerk session + staff allow-list) ──────────────────

router.get("/admin/inbox", requireStaff, async (req, res) => {
  try {
    const query = GetAdminInboxQueryParams.parse(req.query);
    const result = await getInbox(query);
    return res.json(GetAdminInboxResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to load admin inbox");
    return res.status(500).json({ error: "Could not load the inbox." });
  }
});

router.get("/admin/inbox/unread-count", requireStaff, async (req, res) => {
  try {
    const count = await getUnreadCount();
    return res.json(GetAdminInboxUnreadCountResponse.parse({ count }));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch inbox unread count");
    return res.status(500).json({ error: "Could not fetch unread count." });
  }
});

router.patch(
  "/admin/inbox/messages/:messageId/read",
  requireStaff,
  async (req, res) => {
    try {
      const { messageId } = MarkMessageReadParams.parse(req.params);
      const { read } = MarkMessageReadBody.parse(req.body);
      const updated = await markMessageRead(messageId, read);
      if (!updated) {
        return res.status(404).json({ error: "Message not found." });
      }
      return res.json(MarkMessageReadResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to mark message read");
      return res.status(500).json({ error: "Could not update message." });
    }
  },
);

router.patch(
  "/admin/inbox/threads/:sender/read",
  requireStaff,
  async (req, res) => {
    try {
      const { sender } = MarkThreadReadParams.parse(req.params);
      const { read } = MarkThreadReadBody.parse(req.body);
      await markThreadRead(decodeURIComponent(sender), read);
      return res.json(MarkThreadReadResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to mark thread read");
      return res.status(500).json({ error: "Could not update thread." });
    }
  },
);

// ─── SendGrid Inbound Parse endpoint (no auth, verified by shared secret) ───

// Use memory storage — we only need form fields, not file buffers.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * POST /api/inbox/email
 *
 * Receives SendGrid Inbound Parse multipart POSTs.
 * Verification: SendGrid includes a shared key in a custom header or query
 * param. Set SENDGRID_INBOUND_SECRET to a random string and configure
 * SendGrid to POST to:
 *   https://<your-domain>/api/inbox/email?secret=<SENDGRID_INBOUND_SECRET>
 *
 * Docs: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
 */
router.post(
  "/inbox/email",
  upload.any(),
  async (req, res) => {
    // Verify shared secret to prevent spoofed requests.
    const secret = process.env.SENDGRID_INBOUND_SECRET;
    if (secret) {
      const provided =
        req.query["secret"] ?? req.headers["x-sendgrid-secret"] ?? "";
      const expectedBuf = Buffer.from(secret, "utf8");
      const providedBuf = Buffer.from(String(provided), "utf8");
      const match =
        expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf);
      if (!match) {
        logger.warn("SendGrid Inbound Parse: invalid secret, rejecting");
        // Return 200 so SendGrid doesn't keep retrying bad requests.
        return res.sendStatus(200);
      }
    }

    try {
      const fields = req.body as Record<string, string | undefined>;

      const from: string = fields.from ?? "";
      const subject: string = fields.subject ?? "";
      // Plain-text body preferred; fall back to HTML stripped of tags.
      let body: string =
        fields.text ??
        (fields.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      body = body.slice(0, 10_000);

      // Extract sender address from "Name <email@example.com>" format.
      const emailMatch = from.match(/<([^>]+)>/);
      const senderEmail = (emailMatch ? emailMatch[1] : from).trim().toLowerCase();
      const nameMatch = from.match(/^([^<]+)</);
      const displayName = nameMatch ? nameMatch[1].trim() : null;

      // Check for attachments
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const hasMedia = files.length > 0;

      if (!senderEmail) {
        logger.warn("SendGrid Inbound Parse: missing from address");
        return res.sendStatus(200);
      }

      await saveEmailMessage({
        sender: senderEmail,
        displayName: displayName || null,
        subject: subject || null,
        body,
        hasMedia,
      });

      return res.sendStatus(200);
    } catch (err) {
      logger.error({ err }, "SendGrid Inbound Parse processing error");
      // Always ack 200 so SendGrid doesn't retry indefinitely.
      return res.sendStatus(200);
    }
  },
);

export default router;
