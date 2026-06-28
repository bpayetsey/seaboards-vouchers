import { Router, type IRouter } from "express";
import {
  GetAdminMeResponse,
  GetAdminOverviewResponse,
  GetAdminOrdersDetailedResponse,
  GetAdminGroupOrdersResponse,
  RetryInstalmentParams,
  RetryInstalmentResponse,
  CancelOrderParams,
  CancelOrderResponse,
  IssueVoucherBody,
  IssueVoucherResponse,
  LookupVoucherParams,
  LookupVoucherResponse,
  RedeemVoucherParams,
  RedeemVoucherResponse,
  GetAdminCatalogPricesResponse,
  UpdateCatalogPriceBody,
  UpdateCatalogPriceParams,
  UpdateCatalogPriceResponse,
  GetAdminVisitorsResponse,
  GetAdminCalendarQueryParams,
  GetAdminCalendarResponse,
  ListBlockedDatesResponse,
  BlockDateBody,
  BlockDateResponse,
  UnblockDateParams,
  UnblockDateResponse,
  AdminRescheduleBookingParams,
  AdminRescheduleBookingBody,
  AdminRescheduleBookingResponse,
  AdminCancelBookingParams,
  AdminCancelBookingResponse,
} from "@workspace/api-zod";
import { requireStaff, type StaffRequest } from "../middlewares/requireStaff";
import {
  getAdminOverview,
  getAdminOrdersDetailed,
  getAdminGroupOrders,
  retryInstalment,
  cancelOrder,
  issueVoucher,
  lookupVoucher,
  redeemVoucher,
} from "../lib/admin";
import {
  getAdminCalendar,
  listBlockedDates,
  blockDate,
  unblockDate,
  rescheduleBooking,
  cancelBooking,
  MAX_RESCHEDULES,
} from "../lib/dayPass";
import {
  listCatalogPrices,
  updateCatalogPrice,
} from "../lib/catalogPrices";
import { getVisitorAnalytics } from "../lib/analytics";

const router: IRouter = Router();

router.get("/admin/me", requireStaff, (req, res) => {
  const { userEmail } = req as StaffRequest;
  return res.json(GetAdminMeResponse.parse({ email: userEmail, staff: true }));
});

router.get("/admin/overview", requireStaff, async (req, res) => {
  try {
    const overview = await getAdminOverview();
    return res.json(GetAdminOverviewResponse.parse(overview));
  } catch (err) {
    req.log.error({ err }, "Failed to build admin overview");
    return res.status(500).json({ error: "Could not load the overview." });
  }
});

router.get("/admin/visitors", requireStaff, async (req, res) => {
  try {
    const analytics = await getVisitorAnalytics();
    return res.json(GetAdminVisitorsResponse.parse(analytics));
  } catch (err) {
    req.log.error({ err }, "Failed to load visitor analytics");
    return res.status(500).json({ error: "Could not load visitor analytics." });
  }
});

router.get("/admin/orders", requireStaff, async (req, res) => {
  try {
    const orders = await getAdminOrdersDetailed();
    return res.json(GetAdminOrdersDetailedResponse.parse(orders));
  } catch (err) {
    req.log.error({ err }, "Failed to load admin orders");
    return res.status(500).json({ error: "Could not load orders." });
  }
});

router.get("/admin/group-orders", requireStaff, async (req, res) => {
  try {
    const orders = await getAdminGroupOrders();
    return res.json(GetAdminGroupOrdersResponse.parse(orders));
  } catch (err) {
    req.log.error({ err }, "Failed to load admin group orders");
    return res.status(500).json({ error: "Could not load group orders." });
  }
});

router.post(
  "/admin/orders/:orderId/instalments/:instalmentId/retry",
  requireStaff,
  async (req, res) => {
    const { orderId, instalmentId } = RetryInstalmentParams.parse(req.params);
    try {
      const result = await retryInstalment(orderId, instalmentId);
      if ("error" in result) {
        if (result.error === "not_found") {
          return res.status(404).json({ error: "Instalment not found." });
        }
        return res
          .status(409)
          .json({ error: "This instalment can't be retried right now." });
      }
      return res.json(RetryInstalmentResponse.parse(result));
    } catch (err) {
      req.log.error({ err }, "Failed to retry instalment");
      return res.status(500).json({ error: "Could not retry the instalment." });
    }
  },
);

router.post(
  "/admin/orders/:orderId/cancel",
  requireStaff,
  async (req, res) => {
    const { orderId } = CancelOrderParams.parse(req.params);
    try {
      const result = await cancelOrder(orderId);
      if ("error" in result) {
        return res.status(404).json({ error: "Order not found." });
      }
      return res.json(CancelOrderResponse.parse(result));
    } catch (err) {
      req.log.error({ err }, "Failed to cancel order");
      return res.status(500).json({ error: "Could not cancel the order." });
    }
  },
);

router.post("/admin/vouchers", requireStaff, async (req, res) => {
  const parsed = IssueVoucherBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const voucher = await issueVoucher(parsed.data);
    return res.json(IssueVoucherResponse.parse(voucher));
  } catch (err) {
    req.log.error({ err }, "Failed to issue voucher");
    return res.status(500).json({ error: "Could not issue the voucher." });
  }
});

router.get("/admin/vouchers/:code", requireStaff, async (req, res) => {
  const { code } = LookupVoucherParams.parse(req.params);
  try {
    const result = await lookupVoucher(code);
    return res.json(LookupVoucherResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to look up voucher");
    return res.status(500).json({ error: "Could not look up the voucher." });
  }
});

router.post(
  "/admin/vouchers/:code/redeem",
  requireStaff,
  async (req, res) => {
    const { code } = RedeemVoucherParams.parse(req.params);
    try {
      const result = await redeemVoucher(code);
      const body = RedeemVoucherResponse.parse(result);
      if (!result.found) {
        return res.status(404).json(body);
      }
      if (!result.redeemed) {
        return res.status(409).json(body);
      }
      return res.json(body);
    } catch (err) {
      req.log.error({ err }, "Failed to redeem voucher");
      return res.status(500).json({ error: "Could not redeem the voucher." });
    }
  },
);

router.get("/admin/catalog-prices", requireStaff, async (req, res) => {
  try {
    const prices = await listCatalogPrices();
    return res.json(GetAdminCatalogPricesResponse.parse(prices));
  } catch (err) {
    req.log.error({ err }, "Failed to load catalog prices");
    return res.status(500).json({ error: "Could not load prices." });
  }
});

router.put("/admin/catalog-prices/:itemId", requireStaff, async (req, res) => {
  const { itemId } = UpdateCatalogPriceParams.parse(req.params);
  const parsed = UpdateCatalogPriceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    const result = await updateCatalogPrice(itemId, {
      rate: parsed.data.rate,
      was: parsed.data.was,
    });
    if ("error" in result) {
      if (result.error === "not_found") {
        return res.status(404).json({ error: "Voucher not found." });
      }
      return res
        .status(400)
        .json({ error: "Prices must be whole positive amounts." });
    }
    return res.json(UpdateCatalogPriceResponse.parse(result.item));
  } catch (err) {
    req.log.error({ err }, "Failed to update catalog price");
    return res.status(500).json({ error: "Could not update the price." });
  }
});

// ── Day-pass calendar & bookings ────────────────────────────────────────────

router.get("/admin/day-pass/calendar", requireStaff, async (req, res) => {
  const parsed = GetAdminCalendarQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid date range." });
  }
  try {
    const days = await getAdminCalendar(parsed.data.from, parsed.data.to);
    return res.json(GetAdminCalendarResponse.parse({ days }));
  } catch (err) {
    req.log.error({ err }, "Failed to load day-pass calendar");
    return res.status(500).json({ error: "Could not load the calendar." });
  }
});

router.get("/admin/day-pass/blocked-dates", requireStaff, async (req, res) => {
  try {
    const dates = await listBlockedDates();
    return res.json(ListBlockedDatesResponse.parse(dates));
  } catch (err) {
    req.log.error({ err }, "Failed to list blocked dates");
    return res.status(500).json({ error: "Could not load blocked dates." });
  }
});

router.post("/admin/day-pass/blocked-dates", requireStaff, async (req, res) => {
  const parsed = BlockDateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    const row = await blockDate(parsed.data.date, parsed.data.reason ?? null);
    if (!row) {
      return res.status(400).json({ error: "Invalid date." });
    }
    return res.json(BlockDateResponse.parse(row));
  } catch (err) {
    req.log.error({ err }, "Failed to block date");
    return res.status(500).json({ error: "Could not block that date." });
  }
});

router.delete(
  "/admin/day-pass/blocked-dates/:date",
  requireStaff,
  async (req, res) => {
    const { date } = UnblockDateParams.parse(req.params);
    try {
      const ok = await unblockDate(date);
      if (!ok) {
        return res.status(400).json({ error: "Invalid date." });
      }
      return res.json(UnblockDateResponse.parse({ ok: true }));
    } catch (err) {
      req.log.error({ err }, "Failed to unblock date");
      return res.status(500).json({ error: "Could not unblock that date." });
    }
  },
);

router.post(
  "/admin/day-pass/bookings/:bookingId/reschedule",
  requireStaff,
  async (req, res) => {
    const { bookingId } = AdminRescheduleBookingParams.parse(req.params);
    const parsed = AdminRescheduleBookingBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request." });
    }
    try {
      // Admin acts on any booking (email: null) but under the same policy as the
      // customer: the 48h-before cutoff and max-2-reschedules rules are enforced.
      const result = await rescheduleBooking(null, bookingId, parsed.data.visit_date);
      if ("error" in result) {
        const status = result.error === "not_found" ? 404 : 409;
        return res.status(status).json({ error: "Could not reschedule booking." });
      }
      return res.json(
        AdminRescheduleBookingResponse.parse({
          ok: true,
          visit_date: result.booking.visitDate,
          status: result.booking.status,
          reschedules_remaining: MAX_RESCHEDULES - result.booking.rescheduleCount,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to staff-reschedule booking");
      return res.status(500).json({ error: "Could not reschedule booking." });
    }
  },
);

router.post(
  "/admin/day-pass/bookings/:bookingId/cancel",
  requireStaff,
  async (req, res) => {
    const { bookingId } = AdminCancelBookingParams.parse(req.params);
    try {
      // Admin acts on any booking (email: null) but under the same policy as the
      // customer: the 24h / post-2-reschedule penalty (25% kept, 75% credit) applies.
      const result = await cancelBooking(null, bookingId);
      if ("error" in result) {
        const status = result.error === "not_found" ? 404 : 409;
        return res.status(status).json({ error: "Could not cancel booking." });
      }
      return res.json(
        AdminCancelBookingResponse.parse({
          ok: true,
          penalty: result.penalty,
          credit_minor: result.credit_minor,
          penalty_kept_minor: result.penalty_kept_minor,
          currency: result.currency,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to staff-cancel booking");
      return res.status(500).json({ error: "Could not cancel booking." });
    }
  },
);

export default router;
