/**
 * Buildspace API module: src/modules/notifications/routes.ts
 * Reads and updates each user’s durable notification inbox and read state.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { notifications } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

export function notificationRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.get("/notifications", async (context) => {
    const unreadOnly = context.req.query("unread") === "true";
    const items = await context.get("database").db.select().from(notifications)
      .where(and(eq(notifications.userId, currentUserId(context)), unreadOnly ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt)).limit(100);
    return context.json({ items });
  });
  app.post("/notifications/:notificationId/read", async (context) => {
    const { db } = context.get("database");
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, context.req.param("notificationId")), eq(notifications.userId, currentUserId(context))));
    return context.body(null, 204);
  });
  app.post("/notifications/read-all", async (context) => {
    await context.get("database").db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, currentUserId(context)), isNull(notifications.readAt)));
    return context.body(null, 204);
  });
  return app;
}
