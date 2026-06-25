import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

/**
 * Express request augmented with the authenticated client's identity. The
 * dashboard scopes every record to `userEmail`, which is always the user's
 * verified primary email address as held by Clerk.
 */
export interface AuthedRequest extends Request {
  userId: string;
  userEmail: string;
}

/**
 * Requires an authenticated Clerk session and attaches the user's verified
 * primary email to the request. Records are only ever exposed to the email the
 * account actually owns and has verified, so an unverified or missing email is
 * rejected.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
    (req as AuthedRequest).userId = userId;
    (req as AuthedRequest).userEmail = primary.emailAddress.trim().toLowerCase();
    next();
  } catch (err) {
    req.log.error({ err }, "Failed to resolve authenticated user");
    res.status(401).json({ error: "Unauthorized" });
  }
}
