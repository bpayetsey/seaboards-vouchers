import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { CreateStoreOrderBody, ConfirmStoreOrderParams } from "@workspace/api-zod";
import {
  getStorefrontConfig,
  createStoreOrder,
  confirmStoreOrder,
  chargeDueInstalments,
  getAdminOrders,
} from "../lib/storefront";

const router: IRouter = Router();

/** Scheduler/admin-only: require a bearer token matching SESSION_SECRET. */
function isAuthorized(req: Request): boolean | "unconfigured" {
  const adminToken = process.env.SESSION_SECRET;
  if (!adminToken) return "unconfigured";
  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(adminToken);
  const got = Buffer.from(provided);
  return (
    got.length === expected.length && crypto.timingSafeEqual(got, expected)
  );
}

router.get("/storefront/config", async (_req, res) => {
  return res.json(await getStorefrontConfig());
});

router.post("/storefront/orders", async (req, res) => {
  const parsed = CreateStoreOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const result = await createStoreOrder(parsed.data);
    if ("error" in result) {
      if (result.error === "payments_unavailable") {
        return res.status(503).json({
          error:
            "Online payments are not connected yet. Connect Stripe to take orders.",
        });
      }
      const message =
        result.error === "invalid_buyer"
          ? "Enter your name and a valid email."
          : "Invalid voucher selection.";
      return res.status(400).json({ error: message });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create storefront order");
    return res
      .status(503)
      .json({ error: "Could not start checkout. Please try again later." });
  }
});

router.post("/storefront/orders/:orderId/confirm", async (req, res) => {
  const { orderId } = ConfirmStoreOrderParams.parse(req.params);
  try {
    const result = await confirmStoreOrder(orderId);
    if ("error" in result) {
      return res.status(404).json({ error: "Order not found." });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to confirm storefront order");
    return res.status(500).json({ error: "Could not confirm the order." });
  }
});

router.post("/storefront/jobs/charge-instalments", async (req, res) => {
  const auth = isAuthorized(req);
  if (auth === "unconfigured") {
    req.log.error("SESSION_SECRET not configured; refusing instalment job");
    return res.status(503).json({ error: "Job is not available" });
  }
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  return res.json(await chargeDueInstalments());
});

router.get("/storefront/admin/orders", async (req, res) => {
  const auth = isAuthorized(req);
  if (auth === "unconfigured") {
    req.log.error("SESSION_SECRET not configured; refusing admin orders");
    return res.status(503).json({ error: "Admin view is not available" });
  }
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  return res.json(await getAdminOrders());
});

export default router;
