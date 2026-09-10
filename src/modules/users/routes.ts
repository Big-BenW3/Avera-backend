/**
 * Buildspace API module: src/modules/users/routes.ts
 * Provides profile, people, block, and report-facing user operations separate from authentication.
 */

import { and, eq, ilike, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { userBlocks, users } from "../../db/schema.js";
import { uuidParam, validationError } from "../../lib/http.js";
import { likePattern } from "../../lib/sanitize.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

export function userRoutes() {
  const app = new Hono<AppEnv>();

  // People directory and profile pages require a signed-in user.
  app.use("/people", requireAuth);

  // Search the people directory by handle or display name.
  app.get("/people", async (context) => {
    const query = context.req.query("q")?.trim().slice(0, 120);
    if (!query) return context.json({ items: [] });
    const pattern = likePattern(query);
    const { db } = context.get("database");
    const items = await db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        bio: users.bio,
        skills: users.skills,
      })
      .from(users)
      .where(or(ilike(users.handle, pattern), ilike(users.displayName, pattern)))
      .limit(50);
    return context.json({ items });
  });
  // View one public profile by handle.
  app.use("/people/:handle", requireAuth);
  app.get("/people/:handle", async (context) => {
    const { db } = context.get("database");
    const person = (
      await db
        .select({
          id: users.id,
          handle: users.handle,
          displayName: users.displayName,
          bio: users.bio,
          skills: users.skills,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.handle, context.req.param("handle")))
        .limit(1)
    )[0];
    return person
      ? context.json({ person })
      : context.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Person not found.",
              requestId: context.get("requestId"),
            },
          },
          404,
        );
  });
  // Block a user so they cannot interact with you (no-op if already blocked).
  app.use("/me/blocks/*", requireAuth);
  app.post("/me/blocks/:userId", async (context) => {
    const target = uuidParam(context, "userId");
    if (!target) return validationError(context, "User ID is invalid.");
    const actor = currentUserId(context);
    if (target === actor)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "You cannot block yourself.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const exists = (
      await context
        .get("database")
        .db.select({ id: users.id })
        .from(users)
        .where(eq(users.id, target))
        .limit(1)
    )[0];
    if (!exists)
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Person not found.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    await context
      .get("database")
      .db.insert(userBlocks)
      .values({ blockerUserId: actor, blockedUserId: target })
      .onConflictDoNothing();
    return context.body(null, 204);
  });
  // Unblock a previously blocked user.
  app.delete("/me/blocks/:userId", async (context) => {
    const actor = currentUserId(context);
    const target = uuidParam(context, "userId");
    if (!target) return validationError(context, "User ID is invalid.");
    await context
      .get("database")
      .db.delete(userBlocks)
      .where(and(eq(userBlocks.blockerUserId, actor), eq(userBlocks.blockedUserId, target)));
    return context.body(null, 204);
  });
  return app;
}
