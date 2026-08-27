/**
 * Buildspace API module: src/modules/safety/routes.ts
 * Handles content reports and personal block controls used by trust and safety product flows.
 */

import { Hono } from "hono";
import { z } from "zod";
import { contentReports } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

const reportInput = z.object({ entityType: z.enum(["idea", "space", "profile", "comment"]), entityId: z.string().uuid(), reason: z.enum(["spam", "harassment", "impersonation", "other"]), context: z.string().trim().max(3000).optional() });

export function safetyRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.post("/reports", async (context) => {
    const parsed = reportInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Report details are invalid.", requestId: context.get("requestId") } }, 400);
    const [report] = await context.get("database").db.insert(contentReports).values({ reporterUserId: currentUserId(context), ...parsed.data }).returning();
    // Reports are intentionally post-publication. Only moderation staff tooling can read or resolve them.
    return context.json({ report }, 201);
  });
  return app;
}
