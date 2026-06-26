import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ratesRouter from "./rates";
import groupOrdersRouter from "./groupOrders";
import payRouter from "./pay";
import storefrontRouter from "./storefront";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ratesRouter);
router.use(groupOrdersRouter);
router.use(payRouter);
router.use(storefrontRouter);
router.use(dashboardRouter);
router.use(adminRouter);

export default router;
