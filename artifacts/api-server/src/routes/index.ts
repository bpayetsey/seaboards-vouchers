import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ratesRouter from "./rates";
import groupOrdersRouter from "./groupOrders";
import payRouter from "./pay";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ratesRouter);
router.use(groupOrdersRouter);
router.use(payRouter);

export default router;
