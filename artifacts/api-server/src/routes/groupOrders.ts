import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateGroupOrderBody,
  GetGroupOrderParams,
  ResendLineParams,
} from "@workspace/api-zod";
import {
  createGroupOrder,
  getOrganiserView,
  resendLine,
  sweepExpired,
} from "../lib/groupVouchers";

const router: IRouter = Router();

router.post("/group-orders", async (req, res) => {
  const parsed = CreateGroupOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  try {
    const result = await createGroupOrder(parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create group order");
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create order",
    });
  }
});

router.get("/group-orders/:statusToken", async (req, res) => {
  const { statusToken } = GetGroupOrderParams.parse(req.params);
  const view = await getOrganiserView(statusToken);
  if (!view) {
    return res.status(404).json({ error: "Order not found" });
  }
  return res.json(view);
});

router.post(
  "/group-orders/:statusToken/lines/:lineId/resend",
  async (req, res) => {
    const { statusToken, lineId } = ResendLineParams.parse(req.params);
    const result = await resendLine(statusToken, lineId);
    if (!result) {
      return res.status(404).json({ error: "Line not found" });
    }
    return res.json(result);
  },
);

router.post("/group-orders/admin/sweep", async (req, res) => {
  // Admin/scheduler-only endpoint. Requires a bearer token matching the
  // server's SESSION_SECRET so it is never world-callable.
  const adminToken = process.env.SESSION_SECRET;
  if (!adminToken) {
    req.log.error("SESSION_SECRET not configured; refusing sweep");
    return res.status(503).json({ error: "Sweep is not available" });
  }

  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(adminToken);
  const got = Buffer.from(provided);
  if (
    got.length !== expected.length ||
    !crypto.timingSafeEqual(got, expected)
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await sweepExpired();
  return res.json(result);
});

export default router;
