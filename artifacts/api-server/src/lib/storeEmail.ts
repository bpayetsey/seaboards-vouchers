import type { StoreOrder, StoreInstallment, StoreVoucher } from "@workspace/db";
import { logger } from "./logger";

/**
 * Email stubs. Wire a real provider (Postmark, Resend, SES, …) later — for now
 * they log so the flow is observable in development.
 */

export async function sendVoucherEmail(
  order: StoreOrder,
  voucher: StoreVoucher,
  fullyPaid: boolean,
): Promise<void> {
  logger.info(
    {
      to: order.buyerEmail,
      code: voucher.code,
      status: voucher.status,
      fullyPaid,
    },
    "[email stub] voucher issued",
  );
}

export async function sendActionRequiredEmail(
  order: StoreOrder,
  inst: StoreInstallment,
): Promise<void> {
  logger.info(
    { to: order.buyerEmail, instalment: inst.number },
    "[email stub] payment needs re-authentication",
  );
}

export async function sendPaymentFailedEmail(
  order: StoreOrder,
  inst: StoreInstallment,
): Promise<void> {
  logger.info(
    { to: order.buyerEmail, instalment: inst.number },
    "[email stub] instalment payment failed",
  );
}
