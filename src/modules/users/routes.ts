/**
 * Buildspace API module: src/modules/users/routes.ts
 * Provides profile, people, block, and report-facing user operations separate from authentication.
 */

import { and, eq, ilike, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { userBlocks, users } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

export function userRoutes() {
  const app = new Hono<AppEnv>();
  app.get("/people", async (context) => {
    const query = context.req.query("q")?.trim();
    const pattern = `%${query ?? ""}%`;
    const { db } = context.get("database");
    const items = await db.select({ id: users.id, handle: users.handle, displayName: users.displayName, bio: users.bio, skills: users.skills })
      .from(users).where(query ? or(ilike(users.handle, pattern), ilike(users.displayName, pattern)) : undefined).limit(50);
    return context.json({ items });
  });
  app.get("/people/:handle", async (context) => {
    const { db } = context.get("database");
    const person = (await db.select({ id: users.id, handle: users.handle, displayName: users.displayName, bio: users.bio, skills: users.skills, createdAt: users.createdAt }).from(users).where(eq(users.handle, context.req.param("handle"))).limit(1))[0];
    return person ? context.json({ person }) : context.json({ error: { code: "NOT_FOUND", message: "Person not found.", requestId: context.get("requestId") } }, 404);
  });
  app.use("/me/blocks/*", requireAuth);
  app.post("/me/blocks/:userId", async (context) => {
    const target = context.req.param("userId");
    const actor = currentUserId(context);
    if (target === actor) return context.json({ error: { code: "VALIDATION_ERROR", message: "You cannot block yourself.", requestId: context.get("requestId") } }, 400);
    await context.get("database").db.insert(userBlocks).values({ blockerUserId: actor, blockedUserId: target }).onConflictDoNothing();
    return context.body(null, 204);
  });
  app.delete("/me/blocks/:userId", async (context) => {
    const actor = currentUserId(context);
    await context.get("database").db.delete(userBlocks).where(and(eq(userBlocks.blockerUserId, actor), eq(userBlocks.blockedUserId, context.req.param("userId"))));
    return context.body(null, 204);
  });
  return app;
}
