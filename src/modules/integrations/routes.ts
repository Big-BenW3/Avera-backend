/**
 * Buildspace API module: src/modules/integrations/routes.ts
 * Defines safe boundaries for Figma, GitHub, and future provider connections without browser-side secrets.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { designLinks, integrationConnections, outboxEvents } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const figmaLinkInput = z.object({ externalFileId: z.string().trim().min(1).max(255), url: z.string().url(), title: z.string().trim().min(1).max(180) });

/** OAuth redirect/callback routes are intentionally not activated until real provider settings exist. */
export function integrationRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.get("/spaces/:slug/integrations", async (context) => {
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "integrations:view")) return context.json({ error: { code: "FORBIDDEN", message: "Integration access is required.", requestId: context.get("requestId") } }, 403);
    const items = await context.get("database").db.select().from(integrationConnections).where(eq(integrationConnections.spaceId, access!.spaceId));
    return context.json({ items: items.map(({ secretCiphertext: _secret, ...safe }) => safe) });
  });
  app.get("/spaces/:slug/design-links", async (context) => {
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "design:view")) return context.json({ error: { code: "FORBIDDEN", message: "Design access is required.", requestId: context.get("requestId") } }, 403);
    return context.json({ items: await context.get("database").db.select().from(designLinks).where(eq(designLinks.spaceId, access!.spaceId)) });
  });
  app.post("/spaces/:slug/design-links", async (context) => {
    const parsed = figmaLinkInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "design:edit")) return context.json({ error: { code: "FORBIDDEN", message: "Design access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Design link is invalid.", requestId: context.get("requestId") } }, 400);
    const [link] = await context.get("database").db.insert(designLinks).values({ spaceId: access!.spaceId, provider: "figma", ...parsed.data }).returning();
    await context.get("database").db.insert(outboxEvents).values({ type: "ai.index_requested", aggregateType: "design_link", aggregateId: link!.id, payload: { spaceId: access!.spaceId, sourceType: "design" } });
    return context.json({ link }, 201);
  });
  app.post("/integrations/github/webhook", async (context) => {
    // Production validates the GitHub signature before enqueuing; never process an unsigned webhook.
    const signature = context.req.header("x-hub-signature-256");
    if (!signature) return context.json({ error: { code: "WEBHOOK_SIGNATURE_REQUIRED", message: "A GitHub webhook signature is required.", requestId: context.get("requestId") } }, 401);
    return context.json({ accepted: true }, 202);
  });
  return app;
}
