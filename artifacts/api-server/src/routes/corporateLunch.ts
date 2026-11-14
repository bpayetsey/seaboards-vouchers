import { Router, type IRouter } from "express";
import {
  QuoteCorporateLunchBody,
  QuoteCorporateLunchResponse,
  CreateCorporateLunchRequestBody,
  GetAdminCorporateLunchRequestsResponse,
  UpdateCorporateLunchRequestStatusParams,
  UpdateCorporateLunchRequestStatusBody,
  UpdateCorporateLunchRequestStatusResponse,
  GetCorporateLunchClosedDatesResponse,
  GetAdminCorporateLunchCalendarQueryParams,
  GetAdminCorporateLunchCalendarResponse,
  BlockCorporateLunchDateBody,
  BlockCorporateLunchDateResponse,
  UnblockCorporateLunchDateParams,
  UnblockCorporateLunchDateResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/requireStaff";
import { rateLimit } from "../lib/rateLimit";
import {
  CorporateLunchInputError,
  normaliseSelection,
  quoteCorporateLunch,
} from "../lib/corporateLunch";
import {
  blockLunchDate,
  createCorporateLunchRequest,
  getLunchCalendar,
  listCorporateLunchRequests,
  listLunchClosedDates,
  unblockLunchDate,
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

// Public: dates staff have closed, so the request form can grey them out.
router.get("/corporate-lunch/closed-dates", async (req, res) => {
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Mahe" }).format(new Date());
    const dates = await listLunchClosedDates(today);
    return res.json(GetCorporateLunchClosedDatesResponse.parse({ dates }));
  } catch (err) {
    req.log.error({ err }, "Failed to load closed lunch dates");
    return res.status(500).json({ error: "Could not load available dates." });
  }
});

router.get("/admin/corporate-lunch/calendar", requireStaff, async (req, res) => {
  const parsed = GetAdminCorporateLunchCalendarQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid range." });
  try {
    const days = await getLunchCalendar(parsed.data.from, parsed.data.to);
    if (!days) return res.status(400).json({ error: "Invalid range." });
    return res.json(GetAdminCorporateLunchCalendarResponse.parse({ days }));
  } catch (err) {
    req.log.error({ err }, "Failed to load corporate lunch calendar");
    return res.status(500).json({ error: "Could not load the calendar." });
  }
});

router.post("/admin/corporate-lunch/blocked-dates", requireStaff, async (req, res) => {
  const parsed = BlockCorporateLunchDateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  try {
    const row = await blockLunchDate(parsed.data.date, parsed.data.reason ?? null);
    if (!row) return res.status(400).json({ error: "Invalid date." });
    return res.json(BlockCorporateLunchDateResponse.parse(row));
  } catch (err) {
    req.log.error({ err }, "Failed to close lunch date");
    return res.status(500).json({ error: "Could not close that date." });
  }
});

router.delete("/admin/corporate-lunch/blocked-dates/:date", requireStaff, async (req, res) => {
  const parsed = UnblockCorporateLunchDateParams.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Invalid date." });
  try {
    const ok = await unblockLunchDate(parsed.data.date);
    if (!ok) return res.status(400).json({ error: "Invalid date." });
    return res.json(UnblockCorporateLunchDateResponse.parse({ ok: true }));
  } catch (err) {
    req.log.error({ err }, "Failed to reopen lunch date");
    return res.status(500).json({ error: "Could not reopen that date." });
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
