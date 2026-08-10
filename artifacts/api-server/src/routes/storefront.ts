import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import {
  CreateStoreOrderBody,
  ConfirmStoreOrderParams,
  TrackPageViewBody,
  GetDayPassAvailabilityQueryParams,
  GetDayPassAvailabilityResponse,
} from "@workspace/api-zod";
import {
  getStorefrontConfig,
  createStoreOrder,
  confirmStoreOrder,
  chargeDueInstalments,
  getAdminOrders,
} from "../lib/storefront";
import { getAvailability } from "../lib/dayPass";
import { recordPageView } from "../lib/analytics";

const router: IRouter = Router();

/**
 * Best-effort resolve the caller's verified primary email from their Clerk
 * session, or null when not signed in / not verified. Used only to authorise
 * applying account credit at checkout — the storefront itself stays public.
 */
async function optionalVerifiedEmail(req: Request): Promise<string | null> {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return null;
    const user = await clerkClient.users.getUser(auth.userId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    if (!primary || primary.verification?.status !== "verified") return null;
    return primary.emailAddress.trim().toLowerCase();
  } catch {
    return null;
  }
}

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

// Public, fire-and-forget visitor counter. Always responds 200 — recording is
// best-effort and must never break or block a page load.
router.post("/track/page-view", async (req, res) => {
  const parsed = TrackPageViewBody.safeParse(req.body);
  if (parsed.success) {
    const userAgent = req.get("user-agent") ?? "";
    await recordPageView({
      path: parsed.data.path,
      ip: req.ip ?? "",
      userAgent,
    });
  }
  return res.json({ ok: true });
});

router.get("/storefront/day-pass/availability", async (req, res) => {
  const parsed = GetDayPassAvailabilityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { from, to, pax } = parsed.data;
  // Cap the range so a public caller can't request an unbounded scan.
  const days = await getAvailability(from, to, pax ?? 1);
  const validated = GetDayPassAvailabilityResponse.parse({ days });
  return res.json(validated);
});

router.post("/storefront/orders", async (req, res) => {
  const parsed = CreateStoreOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    // Resolve the verified email server-side only when credit is requested, so
    // the client can never claim another account's credit by spoofing the body.
    const authedEmail =
      parsed.data.credit_minor && Number(parsed.data.credit_minor) > 0
        ? await optionalVerifiedEmail(req)
        : null;
    const result = await createStoreOrder({
      ...parsed.data,
      authed_email: authedEmail,
    });
    if ("error" in result) {
      if (result.error === "payments_unavailable") {
        return res.status(503).json({
          error:
            "Online payments are not connected yet. Connect Stripe to take orders.",
        });
      }
      const messages: Record<string, string> = {
        invalid_buyer: "Enter your name and a valid email.",
        invalid_phone:
          "Enter a valid mobile number including the country code (e.g. +248 2 510 000).",
        invalid_selection: "Invalid voucher selection.",
        date_unavailable:
          "That date is no longer available. Please choose another day.",
        credit_requires_auth:
          "Sign in with the account that holds the credit to use it.",
        credit_too_large:
          "Credit can't cover the full amount — leave a balance to pay.",
        insufficient_credit: "You don't have enough account credit.",
      };
      return res
        .status(400)
        .json({ error: messages[result.error] ?? "Invalid request." });
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
