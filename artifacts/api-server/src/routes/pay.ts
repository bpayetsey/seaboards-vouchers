import { Router, type IRouter } from "express";
import { GetPayLineParams, CreateCheckoutParams } from "@workspace/api-zod";
import { getPayLine, startCheckout } from "../lib/groupVouchers";

const router: IRouter = Router();

function requestOrigin(req: {
  protocol: string;
  get: (name: string) => string | undefined;
}): string {
  const host = req.get("host");
  return `${req.protocol}://${host}`;
}

router.get("/pay/:payToken", async (req, res) => {
  const { payToken } = GetPayLineParams.parse(req.params);
  const line = await getPayLine(payToken);
  if (!line) {
    return res.status(404).json({ error: "Payment link not found" });
  }
  return res.json(line);
});

router.post("/pay/:payToken/checkout", async (req, res) => {
  const { payToken } = CreateCheckoutParams.parse(req.params);
  try {
    const result = await startCheckout(payToken, requestOrigin(req));
    if ("error" in result) {
      if (result.error === "not_found") {
        return res.status(404).json({ error: "Payment link not found" });
      }
      if (result.error === "already_paid") {
        return res.status(409).json({ error: "This share is already paid" });
      }
      return res.status(409).json({ error: "This order is closed" });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create checkout session");
    return res
      .status(503)
      .json({ error: "Payments are not available. Please try again later." });
  }
});

export default router;
