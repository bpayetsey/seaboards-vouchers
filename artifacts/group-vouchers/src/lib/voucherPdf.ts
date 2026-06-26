/**
 * Trigger a browser download of a voucher PDF from one of the binary PDF
 * endpoints. These endpoints stream `application/pdf` and sit outside the JSON
 * API hooks, so we fetch the blob directly and synthesise an anchor click.
 *
 * Cookies are included so the authenticated (dashboard) variant carries the
 * Clerk session; the public confirmation variant ignores them.
 */
export async function downloadVoucherPdf(
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Voucher download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Public, code-addressed endpoint used by the post-purchase confirmation screens. */
export function publicVoucherPdfUrl(code: string): string {
  return `/api/vouchers/${encodeURIComponent(code)}/pdf`;
}

/** Owner-scoped endpoint used by the authenticated client dashboard. */
export function dashboardVoucherPdfUrl(code: string): string {
  return `/api/dashboard/vouchers/${encodeURIComponent(code)}/pdf`;
}

/** Conventional download filename for a voucher code. */
export function voucherPdfFilename(code: string): string {
  return `Seaboards-Voucher-${code.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}
