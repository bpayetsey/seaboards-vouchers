/**
 * Scheduled job: trigger the storefront "Pay in N" instalment charge run.
 *
 * Designed to run as a Replit Scheduled Deployment (e.g. once a day). It calls
 * the already-deployed, authenticated charge endpoint, which finds any
 * instalments that are due and charges the saved cards off-session.
 *
 * Required environment:
 * - STORE_BASE_URL  Production base URL of the deployed app (no trailing slash).
 * - SESSION_SECRET  Bearer token expected by the charge endpoint.
 */

const baseUrl = process.env.STORE_BASE_URL?.replace(/\/+$/, "");
const token = process.env.SESSION_SECRET;

if (!baseUrl) {
  console.error("STORE_BASE_URL is not set; cannot reach the charge endpoint.");
  process.exit(1);
}
if (!token) {
  console.error("SESSION_SECRET is not set; the charge endpoint requires it.");
  process.exit(1);
}
if (!baseUrl.startsWith("https://")) {
  console.error("STORE_BASE_URL must use https:// to avoid sending the token in clear text.");
  process.exit(1);
}

const url = `${baseUrl}/api/storefront/jobs/charge-instalments`;

async function main(): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Charge run failed: HTTP ${res.status} ${res.statusText} — ${text}`);
    process.exit(1);
  }

  let processed: unknown = text;
  try {
    processed = JSON.parse(text);
  } catch {
    // Non-JSON body; fall through with the raw text.
  }
  console.log(`Charge run completed:`, processed);
}

main().catch((err) => {
  console.error("Charge run threw:", err);
  process.exit(1);
});
