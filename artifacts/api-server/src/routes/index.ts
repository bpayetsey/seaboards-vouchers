import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ratesRouter from "./rates";
import groupOrdersRouter from "./groupOrders";
import payRouter from "./pay";
import storefrontRouter from "./storefront";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";
import storageRouter from "./storage";
import galleryRouter from "./gallery";
import vouchersRouter from "./vouchers";
import whatsappRouter from "./whatsapp";
import inboxRouter from "./inbox";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ratesRouter);
router.use(groupOrdersRouter);
router.use(payRouter);
router.use(storefrontRouter);
router.use(dashboardRouter);
router.use(adminRouter);
router.use(storageRouter);
router.use(galleryRouter);
router.use(vouchersRouter);
router.use(whatsappRouter);
router.use(inboxRouter);

export default router;
