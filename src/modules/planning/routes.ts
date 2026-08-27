/**
 * Buildspace API module: src/modules/planning/routes.ts
 * Supports planning notes, promotion to tasks, and roadmap records inside an authorised Space.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { planningNotes, roadmapItems, tasks } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { recordActivity } from "../activity/service.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const noteInput = z.object({ title: z.string().trim().min(2).max(180), body: z.string().trim().min(1).max(4000), color: z.enum(["yellow", "blue", "red", "green"]).default("yellow") });
const roadmapInput = z.object({ horizon: z.enum(["now", "next", "later"]), title: z.string().trim().min(2).max(180), description: z.string().trim().max(2000).optional(), position: z.number().int().min(0).optional() });

async function access(context: Parameters<typeof currentUserId>[0]) {
  const space = await resolveSpaceAccess(context.get("database"), context.req.param("slug") ?? "", currentUserId(context));
  return canAccess(space, currentUserId(context), "planning:edit") ? space : null;
}

export function planningRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);

  app.get("/spaces/:slug/planning-notes", async (context) => {
    const space = await access(context);
    if (!space) return context.json({ error: { code: "FORBIDDEN", message: "Space planning access is required.", requestId: context.get("requestId") } }, 403);
    return context.json({ items: await context.get("database").db.select().from(planningNotes).where(eq(planningNotes.spaceId, space.spaceId)).orderBy(desc(planningNotes.createdAt)) });
  });

  app.post("/spaces/:slug/planning-notes", async (context) => {
    const parsed = noteInput.safeParse(await context.req.json());
    const space = await access(context);
    if (!space) return context.json({ error: { code: "FORBIDDEN", message: "Space planning access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Planning note is invalid.", requestId: context.get("requestId") } }, 400);
    const [note] = await context.get("database").db.insert(planningNotes).values({ ...parsed.data, spaceId: space.spaceId, authorUserId: currentUserId(context) }).returning();
    await recordActivity(context.get("database"), { spaceId: space.spaceId, actorUserId: currentUserId(context), type: "planning_note.created", entityType: "planning_note", entityId: note!.id });
    return context.json({ note }, 201);
  });

  app.post("/spaces/:slug/planning-notes/:noteId/promote", async (context) => {
    const space = await access(context);
    if (!space) return context.json({ error: { code: "FORBIDDEN", message: "Space planning access is required.", requestId: context.get("requestId") } }, 403);
    const note = (await context.get("database").db.select().from(planningNotes).where(and(eq(planningNotes.id, context.req.param("noteId")), eq(planningNotes.spaceId, space.spaceId))).limit(1))[0];
    if (!note) return context.json({ error: { code: "NOT_FOUND", message: "Planning note not found.", requestId: context.get("requestId") } }, 404);
    const [task] = await context.get("database").db.insert(tasks).values({ spaceId: space.spaceId, planningNoteId: note.id, createdByUserId: currentUserId(context), title: note.title, description: note.body, area: "Product" }).returning();
    await context.get("database").db.update(planningNotes).set({ promotedTaskId: task!.id, updatedAt: new Date() }).where(eq(planningNotes.id, note.id));
    await recordActivity(context.get("database"), { spaceId: space.spaceId, actorUserId: currentUserId(context), type: "planning_note.promoted", entityType: "task", entityId: task!.id, payload: { noteId: note.id } });
    return context.json({ task }, 201);
  });

  app.get("/spaces/:slug/roadmap-items", async (context) => {
    const space = await access(context);
    if (!space) return context.json({ error: { code: "FORBIDDEN", message: "Space roadmap access is required.", requestId: context.get("requestId") } }, 403);
    return context.json({ items: await context.get("database").db.select().from(roadmapItems).where(eq(roadmapItems.spaceId, space.spaceId)).orderBy(roadmapItems.horizon, roadmapItems.position) });
  });

  app.post("/spaces/:slug/roadmap-items", async (context) => {
    const parsed = roadmapInput.safeParse(await context.req.json());
    const space = await access(context);
    if (!space) return context.json({ error: { code: "FORBIDDEN", message: "Space roadmap access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Roadmap item is invalid.", requestId: context.get("requestId") } }, 400);
    const [item] = await context.get("database").db.insert(roadmapItems).values({ ...parsed.data, spaceId: space.spaceId }).returning();
    await recordActivity(context.get("database"), { spaceId: space.spaceId, actorUserId: currentUserId(context), type: "roadmap_item.created", entityType: "roadmap_item", entityId: item!.id });
    return context.json({ item }, 201);
  });

  return app;
}
