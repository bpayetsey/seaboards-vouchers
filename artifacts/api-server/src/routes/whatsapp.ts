import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  GetWhatsappConfigResponse,
  GetWhatsappContactsQueryParams,
  GetWhatsappContactsResponse,
  ImportWhatsappContactsBody,
  ImportWhatsappContactsResponse,
  OptOutWhatsappContactParams,
  OptOutWhatsappContactResponse,
  DeleteWhatsappContactParams,
  DeleteWhatsappContactResponse,
  GetWhatsappAudiencesResponse,
  CreateWhatsappAudienceBody,
  CreateWhatsappAudienceResponse,
  DeleteWhatsappAudienceParams,
  DeleteWhatsappAudienceResponse,
  UpdateWhatsappAudienceMembersParams,
  UpdateWhatsappAudienceMembersBody,
  UpdateWhatsappAudienceMembersResponse,
  GetWhatsappCampaignsResponse,
  CreateWhatsappCampaignBody,
  CreateWhatsappCampaignResponse,
  GetWhatsappCampaignParams,
  GetWhatsappCampaignResponse,
  SendWhatsappCampaignParams,
  SendWhatsappCampaignBody,
  SendWhatsappCampaignResponse,
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
} from "../lib/whatsappCampaigns";
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

router.get("/admin/whatsapp/config", requireStaff, async (req, res) => {
  try {
    const config = await getConfig();
    return res.json(GetWhatsappConfigResponse.parse(config));
  } catch (err) {
    req.log.error({ err }, "Failed to load WhatsApp config");
    return res.status(500).json({ error: "Could not load WhatsApp config." });
  }
});

router.get("/admin/whatsapp/contacts", requireStaff, async (req, res) => {
  const params = GetWhatsappContactsQueryParams.safeParse(req.query);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }
  try {
    const result = await listContacts({
      search: params.data.search,
      audienceId: params.data.audienceId,
    });
    return res.json(GetWhatsappContactsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list WhatsApp contacts");
    return res.status(500).json({ error: "Could not load contacts." });
  }
});

router.post(
  "/admin/whatsapp/contacts/import",
  requireStaff,
  async (req, res) => {
    const parsed = ImportWhatsappContactsBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      const result = await importContacts({
        rows: parsed.data.rows,
        default_country: parsed.data.default_country,
        consent: parsed.data.consent,
        audience_id: parsed.data.audience_id,
      });
      return res.json(ImportWhatsappContactsResponse.parse(result));
    } catch (err) {
      req.log.error({ err }, "Failed to import WhatsApp contacts");
      return res.status(500).json({ error: "Could not import contacts." });
    }
  },
);

router.post(
  "/admin/whatsapp/contacts/:contactId/opt-out",
  requireStaff,
  async (req, res) => {
    const params = OptOutWhatsappContactParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      const updated = await optOutContact(params.data.contactId);
      if (!updated) return res.status(404).json({ error: "Contact not found." });
      return res.json(OptOutWhatsappContactResponse.parse(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to opt out WhatsApp contact");
      return res.status(500).json({ error: "Could not opt out contact." });
    }
  },
);

router.delete(
  "/admin/whatsapp/contacts/:contactId",
  requireStaff,
  async (req, res) => {
    const params = DeleteWhatsappContactParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      await deleteContact(params.data.contactId);
      return res.json(DeleteWhatsappContactResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to delete WhatsApp contact");
      return res.status(500).json({ error: "Could not delete contact." });
    }
  },
);

router.get("/admin/whatsapp/audiences", requireStaff, async (req, res) => {
  try {
    const result = await listAudiences();
    return res.json(GetWhatsappAudiencesResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list WhatsApp audiences");
    return res.status(500).json({ error: "Could not load audiences." });
  }
});

router.post("/admin/whatsapp/audiences", requireStaff, async (req, res) => {
  const parsed = CreateWhatsappAudienceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const created = await createAudience({
      name: parsed.data.name,
      description: parsed.data.description,
      contact_ids: parsed.data.contact_ids,
    });
    return res.json(CreateWhatsappAudienceResponse.parse(created));
  } catch (err) {
    req.log.error({ err }, "Failed to create WhatsApp audience");
    return res.status(500).json({ error: "Could not create audience." });
  }
});

router.delete(
  "/admin/whatsapp/audiences/:audienceId",
  requireStaff,
  async (req, res) => {
    const params = DeleteWhatsappAudienceParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      await deleteAudience(params.data.audienceId);
      return res.json(DeleteWhatsappAudienceResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to delete WhatsApp audience");
      return res.status(500).json({ error: "Could not delete audience." });
    }
  },
);

router.post(
  "/admin/whatsapp/audiences/:audienceId/members",
  requireStaff,
  async (req, res) => {
    const params = UpdateWhatsappAudienceMembersParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    const parsed = UpdateWhatsappAudienceMembersBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    try {
      const updated = await updateAudienceMembers(params.data.audienceId, {
        add: parsed.data.add,
        remove: parsed.data.remove,
      });
      if (!updated) return res.status(404).json({ error: "Audience not found." });
      return res.json(UpdateWhatsappAudienceMembersResponse.parse(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to update audience members");
      return res.status(500).json({ error: "Could not update members." });
    }
  },
);

router.get("/admin/whatsapp/campaigns", requireStaff, async (req, res) => {
  try {
    const result = await listCampaigns();
    return res.json(GetWhatsappCampaignsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to list WhatsApp campaigns");
    return res.status(500).json({ error: "Could not load campaigns." });
  }
});

router.post("/admin/whatsapp/campaigns", requireStaff, async (req, res) => {
  const parsed = CreateWhatsappCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const result = await createCampaign({
      name: parsed.data.name,
      audience_id: parsed.data.audience_id,
      template_name: parsed.data.template_name,
      template_language: parsed.data.template_language,
      variables: parsed.data.variables,
      mode: parsed.data.mode,
      scheduled_at: parsed.data.scheduled_at,
    });
    if (!result.ok) {
      const status = result.error === "audience_not_found" ? 400 : 400;
      return res.status(status).json({ error: result.error });
    }
    const detail = await getCampaignDetail(result.id);
    return res.json(CreateWhatsappCampaignResponse.parse(detail));
  } catch (err) {
    req.log.error({ err }, "Failed to create WhatsApp campaign");
    return res.status(500).json({ error: "Could not create campaign." });
  }
});

router.get(
  "/admin/whatsapp/campaigns/:campaignId",
  requireStaff,
  async (req, res) => {
    const params = GetWhatsappCampaignParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    try {
      const detail = await getCampaignDetail(params.data.campaignId);
      if (!detail) return res.status(404).json({ error: "Campaign not found." });
      return res.json(GetWhatsappCampaignResponse.parse(detail));
    } catch (err) {
      req.log.error({ err }, "Failed to load WhatsApp campaign");
      return res.status(500).json({ error: "Could not load campaign." });
    }
  },
);

router.post(
  "/admin/whatsapp/campaigns/:campaignId/send",
  requireStaff,
  async (req, res) => {
    const params = SendWhatsappCampaignParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: params.error.message });
    }
    const parsed = SendWhatsappCampaignBody.safeParse(req.body);
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
      return res.json(SendWhatsappCampaignResponse.parse(detail));
    } catch (err) {
      req.log.error({ err }, "Failed to send WhatsApp campaign");
      return res.status(500).json({ error: "Could not send campaign." });
    }
  },
);

// Scheduler backstop: dispatch due/stuck campaigns. Bearer SESSION_SECRET.
router.post("/whatsapp/jobs/dispatch", async (req, res) => {
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
    logger.error({ err }, "WhatsApp dispatch job failed");
    return res.status(500).json({ error: "Dispatch failed." });
  }
});

export default router;
