/**
 * Buildspace API module: src/modules/tasks/routes.ts
 * Implements task boards, task state changes, comments, and activity entries for Space execution work.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { taskComments, tasks } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { recordActivity } from "../activity/service.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const taskInput = z.object({ title: z.string().trim().min(2).max(180), description: z.string().trim().max(6000).optional(), area: z.string().trim().min(1).max(80).default("Product"), priority: z.enum(["low", "medium", "high"]).default("medium"), assigneeUserId: z.string().uuid().nullable().optional(), roadmapItemId: z.string().uuid().nullable().optional(), dueAt: z.string().datetime().nullable().optional() });
const taskPatchInput = taskInput.partial().extend({ status: z.enum(["todo", "in_progress", "done"]).optional(), position: z.number().int().min(0).optional() });
const commentInput = z.object({ body: z.string().trim().min(1).max(4000) });


export function taskRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);

  app.get("/spaces/:slug/tasks", async (context) => {
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug") ?? "", currentUserId(context));
    if (!canAccess(access, currentUserId(context), "tasks:view")) return context.json({ error: { code: "FORBIDDEN", message: "Task access is required.", requestId: context.get("requestId") } }, 403);
    return context.json({ items: await context.get("database").db.select().from(tasks).where(eq(tasks.spaceId, access!.spaceId)).orderBy(asc(tasks.status), asc(tasks.position)) });
  });

  app.post("/spaces/:slug/tasks", async (context) => {
    const parsed = taskInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(context.get("database"), context.req.param("slug") ?? "", currentUserId(context));
    if (!canAccess(access, currentUserId(context), "tasks:edit")) return context.json({ error: { code: "FORBIDDEN", message: "Task editing access is required.", requestId: context.get("requestId") } }, 403);
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Task details are invalid.", requestId: context.get("requestId") } }, 400);
    const [task] = await context.get("database").db.insert(tasks).values({ ...parsed.data, spaceId: access!.spaceId, createdByUserId: currentUserId(context), dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }).returning();
    await recordActivity(context.get("database"), { spaceId: access!.spaceId, actorUserId: currentUserId(context), type: "task.created", entityType: "task", entityId: task!.id, payload: { title: task!.title } });
    return context.json({ task }, 201);
  });

  app.get("/tasks/:taskId", async (context) => {
    const { db } = context.get("database");
    const task = (await db.select().from(tasks).where(eq(tasks.id, context.req.param("taskId"))).limit(1))[0];
    if (!task) return context.json({ error: { code: "NOT_FOUND", message: "Task not found.", requestId: context.get("requestId") } }, 404);
    const spaceSlug = (await db.execute<{ slug: string }>(`select slug from spaces where id = '${task.spaceId}'`)).rows[0]?.slug;
    const access = spaceSlug ? await resolveSpaceAccess(context.get("database"), spaceSlug, currentUserId(context)) : null;
    if (!canAccess(access, currentUserId(context), "tasks:view")) return context.json({ error: { code: "FORBIDDEN", message: "Task access is required.", requestId: context.get("requestId") } }, 403);
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, task.id)).orderBy(taskComments.createdAt);
    return context.json({ task, comments });
  });

  app.patch("/tasks/:taskId", async (context) => {
    const parsed = taskPatchInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Task update is invalid.", requestId: context.get("requestId") } }, 400);
    const { db } = context.get("database");
    const task = (await db.select().from(tasks).where(eq(tasks.id, context.req.param("taskId"))).limit(1))[0];
    if (!task) return context.json({ error: { code: "NOT_FOUND", message: "Task not found.", requestId: context.get("requestId") } }, 404);
    const accessRows = await db.execute<{ slug: string }>(`select slug from spaces where id = '${task.spaceId}'`);
    const access = accessRows.rows[0] ? await resolveSpaceAccess(context.get("database"), accessRows.rows[0].slug, currentUserId(context)) : null;
    if (!canAccess(access, currentUserId(context), "tasks:edit")) return context.json({ error: { code: "FORBIDDEN", message: "Task editing access is required.", requestId: context.get("requestId") } }, 403);
    const [updated] = await db.update(tasks).set({ ...parsed.data, dueAt: parsed.data.dueAt === undefined ? undefined : parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, updatedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
    await recordActivity(context.get("database"), { spaceId: task.spaceId, actorUserId: currentUserId(context), type: "task.updated", entityType: "task", entityId: task.id, payload: { status: updated!.status } });
    return context.json({ task: updated });
  });

  app.post("/tasks/:taskId/comments", async (context) => {
    const parsed = commentInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Comment is invalid.", requestId: context.get("requestId") } }, 400);
    const { db } = context.get("database");
    const task = (await db.select().from(tasks).where(eq(tasks.id, context.req.param("taskId"))).limit(1))[0];
    if (!task) return context.json({ error: { code: "NOT_FOUND", message: "Task not found.", requestId: context.get("requestId") } }, 404);
    const [comment] = await db.insert(taskComments).values({ taskId: task.id, authorUserId: currentUserId(context), body: parsed.data.body }).returning();
    await recordActivity(context.get("database"), { spaceId: task.spaceId, actorUserId: currentUserId(context), type: "task.comment_created", entityType: "task_comment", entityId: comment!.id, payload: { taskId: task.id } });
    return context.json({ comment }, 201);
  });

  return app;
}
