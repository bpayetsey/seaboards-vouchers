import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  ResendOrganisedLineParams,
  ResendVoucherEmailParams,
  PayOrderInstalmentsParams,
  PayOrderInstalmentsBody,
  PayOrderInstalmentsResponse,
  AssignBookingDateParams,
  AssignBookingDateBody,
  AssignBookingDateResponse,
  RescheduleBookingParams,
  RescheduleBookingBody,
  RescheduleBookingResponse,
  CancelBookingParams,
  CancelBookingResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getDashboardForEmail } from "../lib/dashboard";
import { payInstalmentsForOrder } from "../lib/storefront";
import {
  assignBookingDate,
  rescheduleBooking,
  cancelBooking,
  type BookingActionError,
  MAX_RESCHEDULES,
} from "../lib/dayPass";
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

/** Map a booking-action error to a client-friendly 4xx response. */
function bookingErrorResponse(
  err: BookingActionError,
): { status: number; message: string } {
  const map: Record<BookingActionError["error"], { status: number; message: string }> = {
    not_found: { status: 404, message: "Booking not found." },
    not_active: { status: 409, message: "This booking can no longer be changed." },
    already_dated: { status: 409, message: "This booking already has a date." },
    not_dated: { status: 409, message: "Assign a date before rescheduling." },
    too_late: {
      status: 409,
      message: "Reschedules must be made at least 48 hours before your visit.",
    },
    no_reschedules: {
      status: 409,
      message: "You've used both free reschedules. Cancel for credit instead.",
    },
    closed_tuesday: { status: 409, message: "The resort is closed on Tuesdays." },
    past: { status: 409, message: "Choose a date in the future." },
    invalid_date: { status: 400, message: "Choose a valid date." },
    blocked: { status: 409, message: "That date is unavailable." },
    full: { status: 409, message: "That date is fully booked. Please choose another." },
  };
  return map[err.error] ?? { status: 409, message: "Could not update the booking." };
}

/**
 * Assign a visit date to an undated (gift / undated-at-purchase) booking the
 * authenticated client owns. Atomically reserves daily capacity.
 */
router.post(
  "/dashboard/bookings/:bookingId/assign",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { bookingId } = AssignBookingDateParams.parse(req.params);
    const { visit_date } = AssignBookingDateBody.parse(req.body ?? {});
    try {
      const result = await assignBookingDate(userEmail, bookingId, visit_date);
      if ("error" in result) {
        const { status, message } = bookingErrorResponse(result);
        return res.status(status).json({ error: message });
      }
      return res.json(
        AssignBookingDateResponse.parse({
          ok: true,
          visit_date: result.booking.visitDate,
          status: result.booking.status,
          reschedules_remaining:
            MAX_RESCHEDULES - result.booking.rescheduleCount,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to assign day-pass date");
      return res
        .status(500)
        .json({ error: "Could not book that date right now." });
    }
  },
);

/**
 * Reschedule a dated booking the authenticated client owns. Enforces the
 * 48h-before and max-2-free-reschedules rules.
 */
router.post(
  "/dashboard/bookings/:bookingId/reschedule",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { bookingId } = RescheduleBookingParams.parse(req.params);
    const { visit_date } = RescheduleBookingBody.parse(req.body ?? {});
    try {
      const result = await rescheduleBooking(userEmail, bookingId, visit_date);
      if ("error" in result) {
        const { status, message } = bookingErrorResponse(result);
        return res.status(status).json({ error: message });
      }
      return res.json(
        RescheduleBookingResponse.parse({
          ok: true,
          visit_date: result.booking.visitDate,
          status: result.booking.status,
          reschedules_remaining:
            MAX_RESCHEDULES - result.booking.rescheduleCount,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to reschedule day-pass booking");
      return res
        .status(500)
        .json({ error: "Could not reschedule that booking right now." });
    }
  },
);

/**
 * Cancel a booking the authenticated client owns. No cash refund: the value
 * converts to account credit, less a 25% penalty when within 24h of the visit
 * or after the 2 free reschedules are used.
 */
router.post(
  "/dashboard/bookings/:bookingId/cancel",
  requireAuth,
  async (req, res) => {
    const { userEmail } = req as AuthedRequest;
    const { bookingId } = CancelBookingParams.parse(req.params);
    try {
      const result = await cancelBooking(userEmail, bookingId);
      if ("error" in result) {
        const { status, message } = bookingErrorResponse(result);
        return res.status(status).json({ error: message });
      }
      return res.json(
        CancelBookingResponse.parse({
          ok: true,
          penalty: result.penalty,
          credit_minor: result.credit_minor,
          penalty_kept_minor: result.penalty_kept_minor,
          currency: result.currency,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to cancel day-pass booking");
      return res
        .status(500)
        .json({ error: "Could not cancel that booking right now." });
    }
  },
);

export default router;
