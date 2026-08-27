/**
 * Buildspace API module: src/modules/ideas/routes.ts
 * Implements the public Idea lifecycle, bookmarks, interest, comments, offers, and Space promotion.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ideaBookmarks, ideaComments, ideaInterests, ideaOffers, ideas, spaces } from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

const createIdeaInput = z.object({ title: z.string().trim().min(4).max(180), body: z.string().trim().min(20).max(6000), category: z.string().trim().min(2).max(80), lookingFor: z.string().trim().max(120).optional() });
const commentInput = z.object({ body: z.string().trim().min(1).max(4000) });
const offerInput = z.object({ offer: z.string().trim().min(5).max(1000), availability: z.string().trim().max(80).optional() });
const promoteInput = z.object({ name: z.string().trim().min(2).max(140), summary: z.string().trim().min(10).max(500), type: z.enum(["startup", "hackathon", "open_source", "client_project", "personal", "experiment"]), visibility: z.enum(["public", "private"]).default("private") });

async function ownedIdea(context: Parameters<typeof currentUserId>[0], ideaId: string) {
  const { db } = context.get("database");
  const row = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  const idea = row[0];
  return idea?.authorUserId === currentUserId(context) ? idea : null;
}

/** Public Idea flows: create, interest, offers, discussion, creator moderation, and deliberate Space promotion. */
export function ideaRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/ideas/:ideaId", async (context) => {
    const { db } = context.get("database");
    const ideaId = context.req.param("ideaId");
    const idea = (await db.select().from(ideas).where(and(eq(ideas.id, ideaId), eq(ideas.isPublic, true))).limit(1))[0];
    if (!idea) return context.json({ error: { code: "NOT_FOUND", message: "Idea not found.", requestId: context.get("requestId") } }, 404);
    const comments = await db.select().from(ideaComments).where(and(eq(ideaComments.ideaId, ideaId), isNull(ideaComments.hiddenAt))).orderBy(ideaComments.createdAt);
    return context.json({ idea, comments });
  });

  app.use("/ideas/*", requireAuth);
  app.post("/ideas", async (context) => {
    const parsed = createIdeaInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Idea details are invalid.", requestId: context.get("requestId") } }, 400);
    const { db } = context.get("database");
    const [idea] = await db.insert(ideas).values({ authorUserId: currentUserId(context), ...parsed.data }).returning();
    return context.json({ idea }, 201);
  });

  app.post("/ideas/:ideaId/bookmark", async (context) => {
    const { db } = context.get("database");
    await db.insert(ideaBookmarks).values({ ideaId: context.req.param("ideaId"), userId: currentUserId(context) }).onConflictDoNothing();
    return context.body(null, 204);
  });
  app.delete("/ideas/:ideaId/bookmark", async (context) => {
    const { db } = context.get("database");
    await db.delete(ideaBookmarks).where(and(eq(ideaBookmarks.ideaId, context.req.param("ideaId")), eq(ideaBookmarks.userId, currentUserId(context))));
    return context.body(null, 204);
  });

  app.post("/ideas/:ideaId/interest", async (context) => {
    const { db } = context.get("database");
    await db.insert(ideaInterests).values({ ideaId: context.req.param("ideaId"), userId: currentUserId(context) }).onConflictDoNothing();
    return context.body(null, 204);
  });
  app.delete("/ideas/:ideaId/interest", async (context) => {
    const { db } = context.get("database");
    await db.delete(ideaInterests).where(and(eq(ideaInterests.ideaId, context.req.param("ideaId")), eq(ideaInterests.userId, currentUserId(context))));
    return context.body(null, 204);
  });

  app.post("/ideas/:ideaId/offers", async (context) => {
    const parsed = offerInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Offer details are invalid.", requestId: context.get("requestId") } }, 400);
    const { db } = context.get("database");
    const [offer] = await db.insert(ideaOffers).values({ ideaId: context.req.param("ideaId"), userId: currentUserId(context), ...parsed.data })
      .onConflictDoUpdate({ target: [ideaOffers.ideaId, ideaOffers.userId], set: { offer: parsed.data.offer, availability: parsed.data.availability ?? null } }).returning();
    return context.json({ offer }, 201);
  });

  app.post("/ideas/:ideaId/comments", async (context) => {
    const parsed = commentInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Comment is invalid.", requestId: context.get("requestId") } }, 400);
    const { db } = context.get("database");
    const [comment] = await db.insert(ideaComments).values({ ideaId: context.req.param("ideaId"), authorUserId: currentUserId(context), body: parsed.data.body }).returning();
    return context.json({ comment }, 201);
  });

  app.post("/ideas/:ideaId/comments/:commentId/hide", async (context) => {
    const idea = await ownedIdea(context, context.req.param("ideaId"));
    if (!idea) return context.json({ error: { code: "FORBIDDEN", message: "Only the Idea creator can hide this comment.", requestId: context.get("requestId") } }, 403);
    const { db } = context.get("database");
    await db.update(ideaComments).set({ hiddenAt: new Date(), hiddenByUserId: currentUserId(context) }).where(and(eq(ideaComments.id, context.req.param("commentId")), eq(ideaComments.ideaId, idea.id)));
    return context.body(null, 204);
  });

  app.get("/ideas/:ideaId/offers", async (context) => {
    const idea = await ownedIdea(context, context.req.param("ideaId"));
    if (!idea) return context.json({ error: { code: "FORBIDDEN", message: "Only the Idea creator can view offers.", requestId: context.get("requestId") } }, 403);
    const { db } = context.get("database");
    return context.json({ items: await db.select().from(ideaOffers).where(eq(ideaOffers.ideaId, idea.id)).orderBy(desc(ideaOffers.createdAt)) });
  });

  app.post("/ideas/:ideaId/promote", async (context) => {
    const input = promoteInput.safeParse(await context.req.json());
    if (!input.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Space details are invalid.", requestId: context.get("requestId") } }, 400);
    const idea = await ownedIdea(context, context.req.param("ideaId"));
    if (!idea) return context.json({ error: { code: "FORBIDDEN", message: "Only the Idea creator can create its Space.", requestId: context.get("requestId") } }, 403);
    const { db } = context.get("database");
    const slug = `${input.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${idea.id.slice(0, 6)}`;
    const [space] = await db.insert(spaces).values({ ownerUserId: currentUserId(context), sourceIdeaId: idea.id, slug, name: input.data.name, summary: input.data.summary, category: idea.category, type: input.data.type, visibility: input.data.visibility }).returning();
    await db.update(ideas).set({ lifecycle: "promoted", promotedSpaceId: space!.id, updatedAt: new Date() }).where(eq(ideas.id, idea.id));
    return context.json({ space }, 201);
  });

  return app;
}
