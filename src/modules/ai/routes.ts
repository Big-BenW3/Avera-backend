/**
 * Buildspace API module: src/modules/ai/routes.ts
 * Exposes Space-scoped Project Memory settings and queued AI runs while excluding private chat content.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { aiCitations, aiRuns, aiSourceDocuments, outboxEvents, spaceAiSettings } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { NvidiaAiProvider } from "../../providers/nvidia.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const runInput = z.object({ kind: z.enum(["planning_interview", "proposal", "summary", "task_breakdown", "memory_question"]), prompt: z.string().trim().min(1).max(12000), sourceIds: z.array(z.string().uuid()).max(30).optional() });
const memoryInput = z.object({ enabledSources: z.array(z.enum(["roadmap", "tasks", "activity", "design", "build"])).min(1), chatExcluded: z.literal(true) });

/** Project Memory is Space-scoped and deliberately excludes chat/DM content. */
export function aiRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);
  app.get("/spaces/:slug/ai/settings", async (context) => {
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "ai:view")) return context.json({ error: { code: "FORBIDDEN", message: "AI access is required.", requestId: context.get("requestId") } }, 403);
    const settings = (await context.get("database").db.select().from(spaceAiSettings).where(eq(spaceAiSettings.spaceId, access!.spaceId)).limit(1))[0];
    return context.json({ settings: settings ?? { spaceId: access!.spaceId, enabledSources: ["roadmap", "tasks", "activity", "design", "build"], chatExcluded: true } });
  });
  app.put("/spaces/:slug/ai/settings", async (context) => {
    const parsed = memoryInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "ai:manage")) return context.json({ error: { code: "FORBIDDEN", message: "AI settings access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Project Memory settings are invalid.", requestId: context.get("requestId") } }, 400);
    const [settings] = await context.get("database").db.insert(spaceAiSettings).values({ spaceId: access!.spaceId, updatedByUserId: currentUserId(context), ...parsed.data, updatedAt: new Date() }).onConflictDoUpdate({ target: spaceAiSettings.spaceId, set: { ...parsed.data, updatedByUserId: currentUserId(context), updatedAt: new Date() } }).returning();
    return context.json({ settings });
  });
  app.post("/spaces/:slug/ai/runs", async (context) => {
    const parsed = runInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "ai:run")) return context.json({ error: { code: "FORBIDDEN", message: "AI access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "AI request is invalid.", requestId: context.get("requestId") } }, 400);
    const config = context.get("config");
    const provider = new NvidiaAiProvider(config);
    if (!provider.configured()) return context.json({ error: { code: "AI_UNCONFIGURED", message: "NVIDIA AI credentials have not been configured.", requestId: context.get("requestId") } }, 503);
    const [run] = await context.get("database").db.insert(aiRuns).values({ spaceId: access!.spaceId, requestedByUserId: currentUserId(context), kind: parsed.data.kind, status: "queued", modelId: config.NVIDIA_NIM_MODEL_ID, input: { prompt: parsed.data.prompt, sourceIds: parsed.data.sourceIds ?? [] } }).returning();
    await context.get("database").db.insert(outboxEvents).values({ type: "ai.run", aggregateType: "ai_run", aggregateId: run!.id, payload: { runId: run!.id, spaceId: access!.spaceId } });
    return context.json({ run }, 202);
  });
  app.get("/spaces/:slug/ai/runs", async (context) => {
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug"), currentUserId(context));
    if (!canAccess(access, currentUserId(context), "ai:view")) return context.json({ error: { code: "FORBIDDEN", message: "AI access is required.", requestId: context.get("requestId") } }, 403);
    const items = await context.get("database").db.select().from(aiRuns).where(eq(aiRuns.spaceId, access!.spaceId)).orderBy(desc(aiRuns.createdAt)).limit(50);
    return context.json({ items });
  });
  app.get("/ai/runs/:runId", async (context) => {
    const run = (await context.get("database").db.select().from(aiRuns).where(eq(aiRuns.id, context.req.param("runId"))).limit(1))[0];
    if (!run) return context.json({ error: { code: "NOT_FOUND", message: "AI run not found.", requestId: context.get("requestId") } }, 404);
    const citations = await context.get("database").db.select().from(aiCitations).where(eq(aiCitations.aiRunId, run.id));
    return context.json({ run, citations });
  });
  return app;
}
