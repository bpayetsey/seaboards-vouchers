import crypto from "node:crypto";
import { sql, gte, desc, count, countDistinct } from "drizzle-orm";
import { db, pageViews } from "@workspace/db";
import { logger } from "./logger";

/**
 * Obvious known-bot/crawler user agents to skip. Deliberately a coarse filter
 * (the task scopes bot handling to "obvious known-bot user agents" only).
 */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|whatsapp|telegrambot|preview|scanner|monitor|curl|wget|python-requests|node-fetch|headless|lighthouse|pingdom|uptimerobot/i;

/**
 * The daily-rotating salt for the visitor hash. Combines a server-side secret
 * with the UTC calendar day, so the resulting hash is stable within a day (to
 * approximate unique visitors) but cannot be linked across days and cannot be
 * reversed back to the raw IP without the secret.
 */
function dailySalt(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const secret = process.env.SESSION_SECRET ?? "seaboards-visitor-salt";
  return `${secret}:${day}`;
}

function visitorHash(ip: string, userAgent: string, date: Date): string {
  return crypto
    .createHmac("sha256", dailySalt(date))
    .update(`${ip}|${userAgent}`)
    .digest("hex");
}

/**
 * Normalize a raw client path into a stable bucket so the top-paths tally is
 * not polluted by per-visitor tokens (pay links, group status tokens, etc.).
 */
function normalizePath(raw: string): string {
  let path = (raw || "/").split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) path = `/${path}`;
  path = path
    .replace(/^\/pay\/[^/]+\/done\/?$/, "/pay/:token/done")
    .replace(/^\/pay\/[^/]+\/?$/, "/pay/:token")
    .replace(/^\/group\/[^/]+\/?$/, "/group/:token");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path.slice(0, 200) || "/";
}

/**
 * Record a single public page view. Resilient by design: any failure (bad
 * input, DB hiccup) is swallowed and logged so it can never break a page load.
 */
export async function recordPageView(input: {
  path: string;
  ip: string;
  userAgent: string;
}): Promise<void> {
  try {
    if (input.userAgent && BOT_RE.test(input.userAgent)) return;
    const now = new Date();
    const path = normalizePath(input.path);
    const hash = visitorHash(input.ip || "unknown", input.userAgent || "", now);
    await db.insert(pageViews).values({ path, visitorHash: hash });
  } catch (err) {
    logger.warn({ err }, "Failed to record page view");
  }
}

interface VisitorDay {
  date: string;
  views: number;
  uniques: number;
}

/** Aggregates for the admin "Site visitors" section. */
export async function getVisitorAnalytics(): Promise<{
  total_views: number;
  today_views: number;
  unique_today: number;
  unique_all_time: number;
  daily: VisitorDay[];
  top_paths: { path: string; views: number }[];
}> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const DAYS = 30;
  const since = new Date(startOfToday);
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));

  const dayExpr = sql<string>`to_char(date_trunc('day', ${pageViews.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const [totals] = await db
    .select({
      total: count(),
      uniqueAll: countDistinct(pageViews.visitorHash),
    })
    .from(pageViews);

  const [today] = await db
    .select({
      views: count(),
      uniques: countDistinct(pageViews.visitorHash),
    })
    .from(pageViews)
    .where(gte(pageViews.createdAt, startOfToday));

  const dailyRows = await db
    .select({
      day: dayExpr,
      views: count(),
      uniques: countDistinct(pageViews.visitorHash),
    })
    .from(pageViews)
    .where(gte(pageViews.createdAt, since))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  const byDay = new Map(
    dailyRows.map((r) => [r.day, { views: r.views, uniques: r.uniques }]),
  );

  // Build a dense series covering the full window, zero-filling empty days.
  const daily: VisitorDay[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const found = byDay.get(key);
    daily.push({
      date: key,
      views: found?.views ?? 0,
      uniques: found?.uniques ?? 0,
    });
  }

  const topRows = await db
    .select({ path: pageViews.path, views: count() })
    .from(pageViews)
    .groupBy(pageViews.path)
    .orderBy(desc(count()))
    .limit(8);

  return {
    total_views: totals?.total ?? 0,
    today_views: today?.views ?? 0,
    unique_today: today?.uniques ?? 0,
    unique_all_time: totals?.uniqueAll ?? 0,
    daily,
    top_paths: topRows.map((r) => ({ path: r.path, views: r.views })),
  };
}
