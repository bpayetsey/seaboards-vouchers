---
name: Voucher email delivery
description: How issued vouchers get emailed to buyers — provider, exactly-once + eventual-delivery design, and what is NOT yet emailed.
---

# Voucher email delivery

When a voucher becomes redeemable, the buyer is emailed the voucher PDF (attachment + a secure download link). This covers: storefront full payment / final instalment cleared, each paid group line (independent/flat), and the split master voucher.

## Provider
- Uses the Replit-managed **SendGrid** connection (no hardcoded secrets). Sender defaults to the connection's verified `from_email`; override via `SENDGRID_FROM_EMAIL`. There is a single connection (production env) used in both dev and prod.
- **Only issued-voucher emails are real.** The instalment "payment failed" / "action required" emails remain log-only stubs.

## Exactly-once + eventual-delivery design (the important part)
Two independent rules combine to guarantee each voucher is emailed exactly once *and* eventually, even across webhook retries and the confirm/admin fallbacks that replay the same issuance code:

1. **Exactly-once = per-row claim.** Each issuance target has its own nullable `*emailed_at` column claimed with a conditional `UPDATE … WHERE …emailed_at IS NULL RETURNING` *before* sending. Lose the race → 0 rows → send nothing. A failed send resets the column to null so the slot can be re-claimed later.

2. **Eventual delivery = state-based eligibility + webhook is the durable retrier.**
   - **Why state-based:** eligibility must be derived from the *current persisted state* (voucher active / line paid+coded / order complete+coded, with `*emailed_at IS NULL`), NOT from whether *this* call performed the paid-transition. A transition-only trigger silently skips the email forever on any replay after the first transition (this was a real regression).
   - **Why webhook propagates:** the Stripe webhook handler passes a "propagate email error" flag so a failed send surfaces as a non-2xx → Stripe retries the event (backoff, ~3 days) → state-based check re-attempts. Buyer/admin-facing callers (storefront confirm fallback, admin manual charge) do NOT propagate, so a transient email outage never breaks their request — the webhook is the safety net.

**How to apply:** any new "email on issuance" path must (a) decide to send from current row state, (b) guard the *send itself* with a claim (not just the row creation), and (c) let the webhook path propagate failures while request paths swallow+log. Never send inside the DB transaction (network call would hold row locks / could fire on a rolled-back tx) — collect/derive after commit.

## Conventions
- Split mode emails the **organiser** (coordinating buyer) only — individual split participants don't each get a voucher; the master voucher is the organiser's.
