/**
 * /api/chat/orders — vouchers and day passes sold from the WhatsApp assistant.
 * Create, confirm and cancel need a bearer token (CHAT_ORDER_TOKEN); the "done"
 * page is public because Stripe sends the buyer's browser to it.
 */
import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  createChatOrder,
  confirmChatOrder,
  cancelChatOrder,
  renderDonePage,
  type ChatOrderInput,
} from "../lib/chatOrders";

const router: IRouter = Router();

function authorized(req: Request): boolean | "unconfigured" {
  const token = process.env.CHAT_ORDER_TOKEN;
  if (!token) return "unconfigured";
  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(token);
  const got = Buffer.from(provided);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function guard(req: Request, res: { status: (n: number) => { json: (b: unknown) => unknown } }): boolean {
  const auth = authorized(req);
  if (auth === "unconfigured") {
    res.status(503).json({ error: "Chat orders are not enabled (CHAT_ORDER_TOKEN is not set)." });
    return false;
  }
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const optInt = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));

router.post("/chat/orders", async (req, res) => {
  if (!guard(req, res)) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const input: ChatOrderInput = {
    type: b.type === "day_pass" ? "day_pass" : "package",
    product_id: String(b.product_id ?? ""),
    nights: optInt(b.nights),
    adults: optInt(b.adults),
    children: optInt(b.children) ?? 0,
    extension: Boolean(b.extension),
    visit_date: typeof b.visit_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date) ? b.visit_date : null,
    name: String(b.name ?? ""),
    email: String(b.email ?? ""),
    phone: String(b.phone ?? ""),
    hold_hours: optInt(b.hold_hours),
    reference: typeof b.reference === "string" ? b.reference : undefined,
  };
  try {
    const result = await createChatOrder(input);
    if ("error" in result) {
      const messages: Record<string, string> = {
        invalid_buyer: "A name and a valid email are needed.",
        invalid_phone: "A valid mobile number with country code is needed.",
        invalid_selection: "That product, number of nights or party size is not valid.",
        date_unavailable: "That date is not available for a day pass.",
        payments_unavailable: "Online payments are not connected.",
      };
      const status = result.error === "payments_unavailable" ? 503 : 400;
      return res.status(status).json({ error: `${messages[result.error] ?? "Invalid request."}${result.detail ? ` (${result.detail})` : ""}`, code: result.error });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create chat order");
    return res.status(503).json({ error: "Could not prepare the payment page. Please try again later." });
  }
});

router.post("/chat/orders/:orderId/confirm", async (req, res) => {
  if (!guard(req, res)) return;
  if (!isUuid(req.params.orderId)) return res.status(404).json({ error: "Order not found." });
  try {
    const status = await confirmChatOrder(req.params.orderId);
    if (!status) return res.status(404).json({ error: "Order not found." });
    return res.json(status);
  } catch (err) {
    req.log.error({ err }, "Failed to confirm chat order");
    return res.status(500).json({ error: "Could not check the order." });
  }
});

router.post("/chat/orders/:orderId/cancel", async (req, res) => {
  if (!guard(req, res)) return;
  if (!isUuid(req.params.orderId)) return res.status(404).json({ error: "Order not found." });
  try {
    const status = await cancelChatOrder(req.params.orderId);
    if (!status) return res.status(404).json({ error: "Order not found." });
    return res.json(status);
  } catch (err) {
    req.log.error({ err }, "Failed to cancel chat order");
    return res.status(500).json({ error: "Could not cancel the order." });
  }
});

// Where Stripe sends the buyer after paying. Public; it only ever reads the
// order's own stored session, so the id in the URL cannot settle anything else.
router.get("/chat/orders/:orderId/done", async (req, res) => {
  res.type("html");
  if (!isUuid(req.params.orderId)) return res.status(404).send(renderDonePage(null));
  try {
    const status = await confirmChatOrder(req.params.orderId);
    return res.status(status ? 200 : 404).send(renderDonePage(status));
  } catch (err) {
    req.log.error({ err }, "Chat order done page failed");
    return res.status(500).send(renderDonePage(null));
  }
});

export default router;
