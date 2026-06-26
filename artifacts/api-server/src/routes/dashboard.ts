import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  ResendOrganisedLineParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getDashboardForEmail } from "../lib/dashboard";
import { resendLineForOrganiser } from "../lib/groupVouchers";

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

export default router;
