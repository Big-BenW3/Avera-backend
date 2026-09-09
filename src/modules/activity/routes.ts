/**
 * Buildspace API module: src/modules/activity/routes.ts
 * Serves the durable Space activity feed used by the workspace activity interface.
 */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { activityEvents } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

export function activityRoutes() {
  const app = new Hono<AppEnv>();
  // Every activity endpoint requires a signed-in user.
  app.use("/*", requireAuth);

  // List the latest activity for a Space the user can access.
  app.get("/spaces/:slug/activity", async (context) => {
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "activity:view"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Activity access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const items = await context
      .get("database")
      .db.select()
      .from(activityEvents)
      .where(eq(activityEvents.spaceId, access!.spaceId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(100);
    return context.json({ items });
  });
  return app;
}
