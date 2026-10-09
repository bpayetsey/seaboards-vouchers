import { Router, type IRouter } from "express";
import { buildMenuPdf, type MenuKind } from "../lib/menuPdf";

const router: IRouter = Router();

/**
 * Public branded PDF of the Half Board menu (default) or the Day Pass menu
 * (`?type=day-pass`), generated on the fly from the shared voucher-content
 * library so it always matches the web page.
 */
router.get("/menu/pdf", async (req, res) => {
  const kind: MenuKind = req.query.type === "day-pass" ? "day-pass" : "half-board";
  try {
    const pdf = await buildMenuPdf(kind);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kind === "day-pass" ? "seaboards-day-pass-menu" : "seaboards-menu"}.pdf"`,
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    req.log.error({ err }, "Failed to build menu PDF");
    return res.status(500).json({ error: "Could not generate the menu PDF." });
  }
});

export default router;
