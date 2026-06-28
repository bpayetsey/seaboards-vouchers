import crypto from "node:crypto";
import express, { Router, type IRouter, type Request } from "express";
import {
  GetEmailConfigResponse,
  GetEmailContactsQueryParams,
  GetEmailContactsResponse,
  ImportEmailContactsBody,
  ImportEmailContactsResponse,
  OptOutEmailContactParams,
  OptOutEmailContactResponse,
  DeleteEmailContactParams,
  DeleteEmailContactResponse,
  GetEmailAudiencesResponse,
  CreateEmailAudienceBody,
  CreateEmailAudienceResponse,
  DeleteEmailAudienceParams,
  DeleteEmailAudienceResponse,
  UpdateEmailAudienceMembersParams,
  UpdateEmailAudienceMembersBody,
  UpdateEmailAudienceMembersResponse,
  GetEmailCampaignsResponse,
  CreateEmailCampaignBody,
  CreateEmailCampaignResponse,
  GetEmailCampaignParams,
  GetEmailCampaignResponse,
  SendEmailCampaignParams,
  SendEmailCampaignBody,
  SendEmailCampaignResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/requireStaff";
import {
  getConfig,
  listContacts,
  importContacts,
  optOutContact,
  deleteContact,
  listAudiences,
  createAudience,
  deleteAudience,
  updateAudienceMembers,
  listCampaigns,
  getCampaignDetail,
  createCampaign,
  sendCampaign,
  dispatchDueCampaigns,
  unsubscribeByToken,
} from "../lib/emailCampaigns";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Scheduler-only: require a bearer token matching SESSION_SECRET. */
function isAuthorized(req: Request): boolean | "unconfigured" {
  const adminToken = process.env.SESSION_SECRET;
  if (!adminToken) return "unconfigured";
  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(adminToken);
  const got = Buffer.from(provided);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

router.get("/admin/email/config", requireStaff, async (req, res) => {
  try {
    const config = await getConfig();
    return res.json(GetEmailConfigResponse.parse(config));
  } catch (err) {
    req.log.error({ err }, "Failed to load email config");
    return res.status(500).json({ error: "Could not load email config." });
  }
});

router.get("/admin/email/contacts", requireStaff, async (req, res) => {
  const params = GetEmailContactsQueryParams.safeParse(req.query);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }
  try {
    const result = await listContacts({
      search: params.data.search,
      audienceId: params.data.audienceId,
    });
    return res.json(GetEmailContactsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list email contacts");
    return res.status(500).json({ error: "Could not load contacts." });
  }
});

router.post("/admin/email/contacts/import", requireStaff, async (req, res) => {
  const parsed = ImportEmailContactsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const result = await importContacts({
      rows: parsed.data.rows,
      consent: parsed.data.consent,
      audience_id: parsed.data.audience_id,
    });
    return res.json(ImportEmailContactsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to import email contacts");
    return res.status(500).json({ error: "Could not import contacts." });
  }
});

router.post(
  "/admin/email/contacts/:contactId/opt-out",
  requireStaff,
  async (req, res) => {
    const params = OptOutEmailContactParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      const updated = await optOutContact(params.data.contactId);
      if (!updated) return res.status(404).json({ error: "Contact not found." });
      return res.json(OptOutEmailContactResponse.parse(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to opt out email contact");
      return res.status(500).json({ error: "Could not opt out contact." });
    }
  },
);

router.delete(
  "/admin/email/contacts/:contactId",
  requireStaff,
  async (req, res) => {
    const params = DeleteEmailContactParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      await deleteContact(params.data.contactId);
      return res.json(DeleteEmailContactResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to delete email contact");
      return res.status(500).json({ error: "Could not delete contact." });
    }
  },
);

router.get("/admin/email/audiences", requireStaff, async (req, res) => {
  try {
    const result = await listAudiences();
    return res.json(GetEmailAudiencesResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list email audiences");
    return res.status(500).json({ error: "Could not load audiences." });
  }
});

router.post("/admin/email/audiences", requireStaff, async (req, res) => {
  const parsed = CreateEmailAudienceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const created = await createAudience({
      name: parsed.data.name,
      description: parsed.data.description,
      contact_ids: parsed.data.contact_ids,
    });
    return res.json(CreateEmailAudienceResponse.parse(created));
  } catch (err) {
    req.log.error({ err }, "Failed to create email audience");
    return res.status(500).json({ error: "Could not create audience." });
  }
});

router.delete(
  "/admin/email/audiences/:audienceId",
  requireStaff,
  async (req, res) => {
    const params = DeleteEmailAudienceParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      await deleteAudience(params.data.audienceId);
      return res.json(DeleteEmailAudienceResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to delete email audience");
      return res.status(500).json({ error: "Could not delete audience." });
    }
  },
);

router.post(
  "/admin/email/audiences/:audienceId/members",
  requireStaff,
  async (req, res) => {
    const params = UpdateEmailAudienceMembersParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    const parsed = UpdateEmailAudienceMembersBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      const updated = await updateAudienceMembers(params.data.audienceId, {
        add: parsed.data.add,
        remove: parsed.data.remove,
      });
      if (!updated) return res.status(404).json({ error: "Audience not found." });
      return res.json(UpdateEmailAudienceMembersResponse.parse(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to update audience members");
      return res.status(500).json({ error: "Could not update members." });
    }
  },
);

router.get("/admin/email/campaigns", requireStaff, async (req, res) => {
  try {
    const result = await listCampaigns();
    return res.json(GetEmailCampaignsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list email campaigns");
    return res.status(500).json({ error: "Could not load campaigns." });
  }
});

router.post("/admin/email/campaigns", requireStaff, async (req, res) => {
  const parsed = CreateEmailCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const result = await createCampaign({
      name: parsed.data.name,
      audience_id: parsed.data.audience_id,
      subject: parsed.data.subject,
      body: parsed.data.body,
      variables: parsed.data.variables,
      mode: parsed.data.mode,
      scheduled_at: parsed.data.scheduled_at,
      daily_limit: parsed.data.daily_limit,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    const detail = await getCampaignDetail(result.id);
    return res.json(CreateEmailCampaignResponse.parse(detail));
  } catch (err) {
    req.log.error({ err }, "Failed to create email campaign");
    return res.status(500).json({ error: "Could not create campaign." });
  }
});

router.get(
  "/admin/email/campaigns/:campaignId",
  requireStaff,
  async (req, res) => {
    const params = GetEmailCampaignParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      const detail = await getCampaignDetail(params.data.campaignId);
      if (!detail) return res.status(404).json({ error: "Campaign not found." });
      return res.json(GetEmailCampaignResponse.parse(detail));
    } catch (err) {
      req.log.error({ err }, "Failed to load email campaign");
      return res.status(500).json({ error: "Could not load campaign." });
    }
  },
);

router.post(
  "/admin/email/campaigns/:campaignId/send",
  requireStaff,
  async (req, res) => {
    const params = SendEmailCampaignParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    const parsed = SendEmailCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      const result = await sendCampaign(params.data.campaignId, {
        mode: parsed.data.mode,
        scheduled_at: parsed.data.scheduled_at,
      });
      if (!result.ok) {
        if (result.error === "not_found") {
          return res.status(404).json({ error: "Campaign not found." });
        }
        return res.status(400).json({ error: result.error });
      }
      const detail = await getCampaignDetail(params.data.campaignId);
      return res.json(SendEmailCampaignResponse.parse(detail));
    } catch (err) {
      req.log.error({ err }, "Failed to send email campaign");
      return res.status(500).json({ error: "Could not send campaign." });
    }
  },
);

// Scheduler backstop: dispatch due/stuck campaigns. Bearer SESSION_SECRET.
router.post("/email/jobs/dispatch", async (req, res) => {
  const authorized = isAuthorized(req);
  if (authorized === "unconfigured") {
    return res.status(503).json({ error: "Scheduler not configured." });
  }
  if (!authorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await dispatchDueCampaigns();
    return res.json({ ok: true, dispatched: result.dispatched });
  } catch (err) {
    logger.error({ err }, "Email dispatch job failed");
    return res.status(500).json({ error: "Dispatch failed." });
  }
});

// Public one-click unsubscribe. RFC 8058 one-click clients POST here; the link
// in the email footer is a GET. Both flip the contact to opted-out (idempotent)
// and never require auth. The token is the unguessable per-contact secret.
function unsubscribePage(ok: boolean): string {
  const heading = ok ? "You're unsubscribed" : "Link not recognised";
  const body = ok
    ? "You will no longer receive marketing emails from The Seaboards Apartments."
    : "This unsubscribe link is invalid or has expired.";
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${heading}</title></head>
  <body style="margin:0;font-family:Georgia,serif;background:#F8F6F1;color:#1F3A5F;">
    <div style="max-width:480px;margin:64px auto;padding:32px;background:#fff;border:1px solid #E4E0D8;border-radius:16px;text-align:center;">
      <h1 style="font-size:20px;margin:0 0 12px;">${heading}</h1>
      <p style="font-size:15px;line-height:1.6;color:#2A2E35;">${body}</p>
    </div>
  </body></html>`;
}

router.get("/email/unsubscribe", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  try {
    const ok = await unsubscribeByToken(token);
    return res.status(ok ? 200 : 404).type("html").send(unsubscribePage(ok));
  } catch (err) {
    logger.error({ err }, "Unsubscribe (GET) failed");
    return res.status(500).type("html").send(unsubscribePage(false));
  }
});

router.post(
  "/email/unsubscribe",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const fromQuery =
      typeof req.query.token === "string" ? req.query.token : "";
    const fromBody =
      req.body && typeof req.body.token === "string" ? req.body.token : "";
    const token = fromQuery || fromBody;
    try {
      await unsubscribeByToken(token);
      // One-click clients only need a 2xx; no body required.
      return res.sendStatus(200);
    } catch (err) {
      logger.error({ err }, "Unsubscribe (POST) failed");
      return res.sendStatus(500);
    }
  },
);

export default router;
