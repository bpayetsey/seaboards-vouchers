import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

/**
 * Express request augmented with the authenticated staff member's identity.
 */
export interface StaffRequest extends Request {
  userId: string;
  userEmail: string;
}

/** Parse the configurable staff allow-list (comma/space/newline separated). */
function staffAllowList(): Set<string> {
  return new Set(
    (process.env.STAFF_EMAILS ?? "")
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Requires an authenticated Clerk session whose verified primary email is on
 * the staff allow-list (`STAFF_EMAILS`). Non-staff are rejected with 403. The
 * browser never holds the scheduler's shared secret — admin endpoints are
 * gated solely by Clerk identity + this allow-list.
 */
export async function requireStaff(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const allow = staffAllowList();
  if (allow.size === 0) {
    req.log.error("STAFF_EMAILS not configured; refusing admin access");
    res.status(403).json({ error: "Admin access is not configured." });
    return;
  }

  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    if (!primary || primary.verification?.status !== "verified") {
      res.status(403).json({ error: "A verified email is required" });
      return;
    }
    const email = primary.emailAddress.trim().toLowerCase();
    if (!allow.has(email)) {
      res.status(403).json({ error: "You are not authorized for the admin area." });
      return;
    }
    (req as StaffRequest).userId = userId;
    (req as StaffRequest).userEmail = email;
    next();
  } catch (err) {
    req.log.error({ err }, "Failed to resolve staff user");
    res.status(401).json({ error: "Unauthorized" });
  }
}
