import { Router, type IRouter } from "express";
import { GetRatesResponse } from "@workspace/api-zod";
import { getRateTable } from "../lib/groupVouchers";

const router: IRouter = Router();

router.get("/rates", async (_req, res) => {
  const data = GetRatesResponse.parse(await getRateTable());
  res.json(data);
});

export default router;
