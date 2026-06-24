import { Router, type IRouter } from "express";
import { GetRatesResponse } from "@workspace/api-zod";
import { getRateTable } from "../lib/groupVouchers";

const router: IRouter = Router();

router.get("/rates", (_req, res) => {
  const data = GetRatesResponse.parse(getRateTable());
  res.json(data);
});

export default router;
