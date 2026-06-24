import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ratesRouter from "./rates";
import groupOrdersRouter from "./groupOrders";
import payRouter from "./pay";
import storefrontRouter from "./storefront";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ratesRouter);
router.use(groupOrdersRouter);
router.use(payRouter);
router.use(storefrontRouter);

export default router;
