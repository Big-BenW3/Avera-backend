/**
 * Buildspace API module: src/modules/integrations/routes.ts
 * Defines safe boundaries for Figma, GitHub, and future provider connections without browser-side secrets.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { designLinks, integrationConnections } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import { webhookRateLimit } from "../../middleware/rate-limit.js";
import type { AppEnv } from "../../types.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const figmaLinkInput = z.object({
  externalFileId: z.string().trim().min(1).max(255),
  url: z.string().url(),
  title: z.string().trim().min(1).max(180),
});

export function integrationRoutes() {
  const app = new Hono<AppEnv>();
  // Space-scoped integration endpoints require a signed-in user.
  // The GitHub webhook below stays public (GitHub cannot present a session cookie).
  app.use("/spaces/*", requireAuth);

  // List the connected third-party integrations for a Space.
  app.get("/spaces/:slug/integrations", async (context) => {
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "integrations:view"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Integration access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const items = await context
      .get("database")
      .db.select()
      .from(integrationConnections)
      .where(eq(integrationConnections.spaceId, access!.spaceId));
    return context.json({ items: items.map(({ secretCiphertext: _secret, ...safe }) => safe) });
  });
  // List the design links for a Space.
  app.get("/spaces/:slug/design-links", async (context) => {
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "design:view"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Design access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    return context.json({
      items: await context
        .get("database")
        .db.select()
        .from(designLinks)
        .where(eq(designLinks.spaceId, access!.spaceId)),
    });
  });
  // Add a design link and tell the AI indexer to pick it up.
  app.post("/spaces/:slug/design-links", async (context) => {
    const parsed = figmaLinkInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "design:edit"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Design access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Design link is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const [link] = await context
      .get("database")
      .db.insert(designLinks)
      .values({ spaceId: access!.spaceId, provider: "figma", ...parsed.data })
      .returning();
    return context.json({ link }, 201);
  });
  // Accept signed GitHub webhook payloads. Public by design: verified via HMAC,
  // never via session cookie. Rate-limited to blunt replay floods.
  app.post("/integrations/github/webhook", webhookRateLimit(), async (context) => {
    const secret = context.get("config").GITHUB_CLIENT_SECRET;
    if (!secret)
      return context.json(
        {
          error: {
            code: "WEBHOOK_UNCONFIGURED",
            message: "GitHub webhook secret is not configured.",
            requestId: context.get("requestId"),
          },
        },
        503,
      );
    const signature = context.req.header("x-hub-signature-256");
    if (!signature)
      return context.json(
        {
          error: {
            code: "WEBHOOK_SIGNATURE_REQUIRED",
            message: "A GitHub webhook signature is required.",
            requestId: context.get("requestId"),
          },
        },
        401,
      );
    const raw = await context.req.text();
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return context.json(
        {
          error: {
            code: "WEBHOOK_SIGNATURE_INVALID",
            message: "GitHub webhook signature is invalid.",
            requestId: context.get("requestId"),
          },
        },
        401,
      );
    return context.json({ accepted: true }, 202);
  });
  return app;
}
