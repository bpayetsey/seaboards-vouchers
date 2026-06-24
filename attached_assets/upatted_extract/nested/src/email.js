// Wire these to your email provider (Resend / SES) or 360dialog for WhatsApp.
// They're stubs for now so the flow runs end-to-end without a provider.

export async function sendVoucherEmail(order, voucher, active) {
  console.log(`[email] voucher ${voucher.code} -> ${order.buyerEmail} (active=${active})`);
}
export async function sendActionRequiredEmail(order, inst) {
  console.log(`[email] instalment ${inst.number} needs authentication -> ${order.buyerEmail}`);
}
export async function sendPaymentFailedEmail(order, inst) {
  console.log(`[email] instalment ${inst.number} failed -> ${order.buyerEmail}`);
}
