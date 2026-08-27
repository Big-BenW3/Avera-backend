/**
 * Buildspace API module: src/modules/files/routes.ts
 * Issues short-lived object-storage URLs after checking Space permissions; file bytes never pass through the API.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fileLinks, files } from "../../db/schema.js";
import { opaqueId } from "../../lib/ids.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { createDownloadUrl, createUploadUrl, storageConfigured } from "../../providers/storage.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const uploadInput = z.object({ fileName: z.string().trim().min(1).max(255), contentType: z.string().min(3).max(160), byteSize: z.number().int().positive().max(25 * 1024 * 1024), entityType: z.enum(["task", "planning_note", "design_link", "space"]), entityId: z.string().uuid() });

export function fileRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.post("/spaces/:slug/files/upload-url", async (context) => {
    const parsed = uploadInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "files:write")) return context.json({ error: { code: "FORBIDDEN", message: "Attachment access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Attachment metadata is invalid.", requestId: context.get("requestId") } }, 400);
    if (!storageConfigured(context.get("config"))) return context.json({ error: { code: "STORAGE_UNCONFIGURED", message: "Object storage credentials have not been configured.", requestId: context.get("requestId") } }, 503);
    const key = `spaces/${access!.spaceId}/${opaqueId("file")}-${parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const [file] = await context.get("database").db.insert(files).values({ ownerUserId: currentUserId(context), objectKey: key, contentType: parsed.data.contentType, byteSize: parsed.data.byteSize, originalName: parsed.data.fileName }).returning();
    await context.get("database").db.insert(fileLinks).values({ fileId: file!.id, spaceId: access!.spaceId, entityType: parsed.data.entityType, entityId: parsed.data.entityId });
    return context.json({ file, uploadUrl: await createUploadUrl(context.get("config"), key, parsed.data.contentType) }, 201);
  });
  app.get("/files/:fileId/download-url", async (context) => {
    const file = (await context.get("database").db.select().from(files).where(eq(files.id, context.req.param("fileId"))).limit(1))[0];
    if (!file) return context.json({ error: { code: "NOT_FOUND", message: "File not found.", requestId: context.get("requestId") } }, 404);
    if (!storageConfigured(context.get("config"))) return context.json({ error: { code: "STORAGE_UNCONFIGURED", message: "Object storage credentials have not been configured.", requestId: context.get("requestId") } }, 503);
    // Authorization is resolved through file links by the full implementation; direct file-owner access remains safe for uploaded files.
    if (file.ownerUserId !== currentUserId(context)) return context.json({ error: { code: "FORBIDDEN", message: "File access is required.", requestId: context.get("requestId") } }, 403);
    return context.json({ downloadUrl: await createDownloadUrl(context.get("config"), file.objectKey) });
  });
  return app;
}
