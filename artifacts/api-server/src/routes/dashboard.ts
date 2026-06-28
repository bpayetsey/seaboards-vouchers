import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  ResendOrganisedLineParams,
  ResendVoucherEmailParams,
  PayOrderInstalmentsParams,
  PayOrderInstalmentsBody,
  PayOrderInstalmentsResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getDashboardForEmail } from "../lib/dashboard";
import { payInstalmentsForOrder } from "../lib/storefront";
import { resendLineForOrganiser } from "../lib/groupVouchers";
import { resolveVoucherByCode, buildVoucherPdf } from "../lib/voucherPdf";
import { sendIssuedVoucherEmail } from "../lib/voucherEmail";
import { rateLimit } from "../lib/rateLimit";
import { sendVoucherPdf } from "./vouchers";

// Self-service voucher email resends: at most 3 per voucher per account every
// 10 minutes, so the button can never be used to spam an address.
const RESEND_LIMIT = 3;
const RESEND_WINDOW_MS = 10 * 60 * 1000;

const router: IRouter = Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  const { userEmail } = req as AuthedRequest;
  try {
    const view = await getDashboardForEmail(userEmail);
    const validated = GetDashboardResponse.parse(view);
    return res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Failed to build client dashboard");
    return res.status(500).json({ error: "Could not load your dashboard." });
  }
});

router.post(
  "/dashboard/group-orders/:orderId/lines/:lineId/resend",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { orderId, lineId } = ResendOrganisedLineParams.parse(req.params);
    try {
      const result = await resendLineForOrganiser(userEmail, orderId, lineId);
      if (!result) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.json(result);
    } catch (err) {
      req.log.error({ err }, "Failed to send organiser reminder");
      return res
        .status(500)
        .json({ error: "Could not send the reminder right now." });
    }
  },
);

/**
 * Pay one or more upcoming "Pay in 3" instalments in advance. Scoped strictly
 * to the authenticated, verified account email — the buyer must own the order.
 * Returns the per-instalment outcome and the refreshed order so the dashboard
 * can re-render its schedule.
 */
router.post(
  "/dashboard/orders/:orderId/pay-instalments",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { orderId } = PayOrderInstalmentsParams.parse(req.params);
    const { numbers } = PayOrderInstalmentsBody.parse(req.body ?? {});
    try {
      const outcome = await payInstalmentsForOrder(userEmail, orderId, numbers);
      if ("error" in outcome) {
        return res.status(404).json({ error: "Order not found" });
      }
      // Re-read the order (post-charge) scoped to the same verified email.
      const view = await getDashboardForEmail(userEmail);
      const order = view.orders.find((o) => o.id === orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      const validated = PayOrderInstalmentsResponse.parse({
        results: outcome.results,
        order,
      });
      return res.json(validated);
    } catch (err) {
      req.log.error({ err }, "Failed to pay instalments in advance");
      return res
        .status(500)
        .json({ error: "Could not process your payment right now." });
    }
  },
);

/**
 * Owner-scoped voucher PDF download. The voucher is resolved by code and only
 * served when the authenticated, verified account email is one of the voucher's
 * authorised owners. Anything else returns 404 so the route never reveals
 * whether a code exists for vouchers the caller does not own.
 */
router.get(
  "/dashboard/vouchers/:code/pdf",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const code = String(req.params.code);
    try {
      const voucher = await resolveVoucherByCode(code);
      if (!voucher || !voucher.authorizedEmails.includes(userEmail)) {
        return res.status(404).json({ error: "Voucher not found" });
      }
      const pdf = await buildVoucherPdf(voucher);
      return sendVoucherPdf(res, voucher.code, pdf);
    } catch (err) {
      req.log.error({ err }, "Failed to build voucher PDF for dashboard");
      return res
        .status(500)
        .json({ error: "Could not generate the voucher PDF." });
    }
  },
);

/**
 * Owner-scoped voucher email resend. Re-sends the voucher PDF email for a
 * voucher the authenticated client owns. The voucher is resolved by code and
 * the resend only proceeds when the verified account email is one of its
 * authorised owners — and the email is always sent to that verified address, so
 * the route can never be used to deliver to an arbitrary recipient. A 404 (not
 * a 403) is returned for unowned/unknown codes so the route never reveals
 * whether a code exists. Rate-limited per account+voucher to prevent spamming.
 */
router.post(
  "/dashboard/vouchers/:code/resend",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { code } = ResendVoucherEmailParams.parse(req.params);
    try {
      const voucher = await resolveVoucherByCode(code);
      if (!voucher || !voucher.authorizedEmails.includes(userEmail)) {
        return res.status(404).json({ error: "Voucher not found" });
      }

      const limit = rateLimit(
        `resend-voucher:${userEmail}:${voucher.code}`,
        RESEND_LIMIT,
        RESEND_WINDOW_MS,
      );
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({
          error:
            "You've requested this voucher email a few times already. Please wait a little while before trying again.",
        });
      }

      await sendIssuedVoucherEmail({ to: userEmail, code: voucher.code });
      return res.json({ status: "sent", email: userEmail });
    } catch (err) {
      req.log.error({ err }, "Failed to resend voucher email from dashboard");
      return res
        .status(500)
        .json({ error: "Could not re-send your voucher email right now." });
    }
  },
);

export default router;
