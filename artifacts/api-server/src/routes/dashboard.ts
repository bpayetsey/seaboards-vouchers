import { Router, type IRouter } from "express";
import { GetDashboardResponse } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getDashboardForEmail } from "../lib/dashboard";

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

export default router;
