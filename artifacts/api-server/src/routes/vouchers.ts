import { Router, type IRouter, type Response } from "express";
import { resolveVoucherByCode, buildVoucherPdf } from "../lib/voucherPdf";

const router: IRouter = Router();

/**
 * Stream an A4 voucher PDF to the client as a download. The voucher code acts as
 * the filename so saved files are self-describing.
 */
export function sendVoucherPdf(
  res: Response,
  code: string,
  pdf: Uint8Array,
): Response {
  const safeCode = code.replace(/[^A-Za-z0-9-]/g, "");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="Seaboards-Voucher-${safeCode}.pdf"`,
  );
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(Buffer.from(pdf));
}

/**
 * Public voucher PDF download, addressed by the voucher's unguessable code. Used
 * by the post-purchase confirmation screens (storefront and group pay links),
 * which already hold the freshly issued code. Knowing a voucher code already
 * grants the right to redeem it, so the code is treated as a capability token
 * and no further authentication is required here.
 */
router.get("/vouchers/:code/pdf", async (req, res) => {
  const code = String(req.params.code);
  try {
    const voucher = await resolveVoucherByCode(code);
    if (!voucher) {
      return res.status(404).json({ error: "Voucher not found" });
    }
    const pdf = await buildVoucherPdf(voucher);
    return sendVoucherPdf(res, voucher.code, pdf);
  } catch (err) {
    req.log.error({ err }, "Failed to build voucher PDF");
    return res
      .status(500)
      .json({ error: "Could not generate the voucher PDF." });
  }
});

export default router;
