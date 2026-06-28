---
name: WhatsApp/email campaign dispatch needs an always-on runtime
description: Why background campaign sends stall on autoscale and how dispatch is scheduled.
---

# Campaign dispatch scheduling

Campaign sends (`dispatchCampaign`/`runDispatch` in `whatsappCampaigns.ts`, mirror in `emailCampaigns.ts`) run as a **background loop detached from the triggering HTTP request** (fired via `void dispatchCampaign()` on create/send). They also self-throttle to a per-campaign `dailyLimit` (rolling 24h), so a large campaign must be **re-poked over multiple days** to fully drain — one run only sends the remaining daily headroom, leaving the campaign in `sending`.

`dispatchDueCampaigns()` is the backstop: it resumes any `sending` campaign and starts due `scheduled` ones. It is also exposed at bearer-protected `POST /api/whatsapp/jobs/dispatch` (and `/api/email/jobs/dispatch`), auth = `Authorization: Bearer <SESSION_SECRET>`.

**Why:** On a Replit **autoscale** deployment the instance is suspended/killed between web requests, so a detached background loop dies mid-send and an in-process `setInterval` does not fire reliably. A live campaign once stalled at 743/9557 sent this way, with nothing to resume it (no scheduler was poking the endpoint).

**How to apply:**
- The recurring dispatcher lives in `artifacts/api-server/src/index.ts` (`setInterval(dispatchTick, 60_000)` + immediate boot kick, guarded by an in-flight flag). It only works on an **always-on Reserved VM** (`deploymentTarget = "vm"`).
- `deploymentTarget` in `.replit` is **not** editable by the agent (no `deployConfig` callback) — the user must pick **Reserved VM** in the Publish dialog.
- Concurrency is safe regardless: `dispatchCampaign` holds a Postgres advisory lock per campaign; per-row queued→sending claim guarantees exactly-once sends.
- The interval intentionally covers **WhatsApp only** — adding email to it would auto-resume any `sending` email campaign in prod, which may be unintended.
