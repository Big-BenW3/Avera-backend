/**
 * Buildspace API module: src/middleware/auth.ts
 * Loads and enforces the self-managed session identity for protected backend routes.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { sessions, users } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import type { AppEnv } from "../types.js";

/**
 * Resolve the opaque browser session against PostgreSQL. We store only a hash of
 * the session token so a database leak cannot be replayed as a browser session.
 */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
  const { db } = context.get("database");
  const config = context.get("config");
  const bearer = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const token = getCookie(context, config.AUTH_COOKIE_NAME) ?? bearer;

  if (token) {
    const record = await db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        handle: users.handle,
        displayName: users.displayName,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ))
      .limit(1);

    const activeSession = record[0];
    if (activeSession) context.set("auth", activeSession);
  }

  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
  await optionalAuth(context, async () => undefined);
  if (!context.get("auth")) {
    return context.json({ error: { code: "UNAUTHENTICATED", message: "Sign in is required.", requestId: context.get("requestId") } }, 401);
  }
  await next();
};

export function currentUserId(context: Context<AppEnv>): string {
  const auth = context.get("auth");
  if (!auth) throw new Error("Authenticated route did not provide an auth context.");
  return auth.userId;
}
