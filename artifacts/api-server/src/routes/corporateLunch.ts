import { Router, type IRouter } from "express";
import {
  QuoteCorporateLunchBody,
  QuoteCorporateLunchResponse,
  CreateCorporateLunchRequestBody,
  GetAdminCorporateLunchRequestsResponse,
  UpdateCorporateLunchRequestStatusParams,
  UpdateCorporateLunchRequestStatusBody,
  UpdateCorporateLunchRequestStatusResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/requireStaff";
import { rateLimit } from "../lib/rateLimit";
import {
  CorporateLunchInputError,
  normaliseSelection,
  quoteCorporateLunch,
} from "../lib/corporateLunch";
import {
  createCorporateLunchRequest,
  listCorporateLunchRequests,
  quoteToApi,
  setCorporateLunchStatus,
} from "../lib/corporateLunchRequests";

const router: IRouter = Router();

const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

// Public: live price for the menu builder. Never returns costs.
router.post("/corporate-lunch/quote", (req, res) => {
  const parsed = QuoteCorporateLunchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  try {
    const selection = normaliseSelection(parsed.data.selection);
    const { quote } = quoteCorporateLunch(selection, parsed.data.guests);
    return res.json(QuoteCorporateLunchResponse.parse(quoteToApi(quote)));
  } catch (err) {
    if (err instanceof CorporateLunchInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Public: store a request and email the client + staff. Nothing is charged.
router.post("/corporate-lunch/requests", async (req, res) => {
  const parsed = CreateCorporateLunchRequestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field." });

  const limit = rateLimit(`corporate-lunch:${req.ip ?? "unknown"}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many requests. Please try again later or contact us by phone." });
  }

  try {
    const { request, quote } = await createCorporateLunchRequest({
      guests: parsed.data.guests,
      selection: parsed.data.selection,
      company: parsed.data.company,
      contactName: parsed.data.contact_name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      eventDate: parsed.data.event_date,
      notes: parsed.data.notes,
    });
    return res
      .status(201)
      .json({ reference: request.reference, quote: quoteToApi(quote) });
  } catch (err) {
    if (err instanceof CorporateLunchInputError) return res.status(400).json({ error: err.message });
    req.log.error({ err }, "Failed to save corporate lunch request");
    return res.status(500).json({ error: "We couldn't send your request. Please try again or contact us by phone." });
  }
});

router.get("/admin/corporate-lunch/requests", requireStaff, async (req, res) => {
  try {
    const requests = await listCorporateLunchRequests();
    return res.json(GetAdminCorporateLunchRequestsResponse.parse({ requests }));
  } catch (err) {
    req.log.error({ err }, "Failed to load corporate lunch requests");
    return res.status(500).json({ error: "Could not load requests." });
  }
});

router.put("/admin/corporate-lunch/requests/:requestId/status", requireStaff, async (req, res) => {
  const params = UpdateCorporateLunchRequestStatusParams.safeParse(req.params);
  const body = UpdateCorporateLunchRequestStatusBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid status." });
  if (!/^[0-9a-f-]{36}$/i.test(params.data.requestId)) return res.status(404).json({ error: "Request not found." });
  try {
    const updated = await setCorporateLunchStatus(params.data.requestId, body.data.status);
    if (!updated) return res.status(404).json({ error: "Request not found." });
    return res.json(UpdateCorporateLunchRequestStatusResponse.parse(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update corporate lunch request");
    return res.status(500).json({ error: "Could not update the request." });
  }
});

export default router;
