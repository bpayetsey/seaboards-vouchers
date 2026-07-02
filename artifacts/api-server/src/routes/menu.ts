import { Router, type IRouter } from "express";
import { buildMenuPdf } from "../lib/menuPdf";

const router: IRouter = Router();

/**
 * Public branded PDF of the Half Board & Day Pass menu, generated on the fly
 * from the shared voucher-content library so it always matches the web page.
 */
router.get("/menu/pdf", async (req, res) => {
  try {
    const pdf = await buildMenuPdf();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="seaboards-menu.pdf"',
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    req.log.error({ err }, "Failed to build menu PDF");
    return res.status(500).json({ error: "Could not generate the menu PDF." });
  }
});

export default router;
