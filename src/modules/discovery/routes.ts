/**
 * Buildspace API module: src/modules/discovery/routes.ts
 * Powers public and signed-in discovery, announcements, search, and followed Space feeds.
 */

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { announcements, ideaInterests, ideas, spaceFollows, spaceMemberships, spaces } from "../../db/schema.js";
import { optionalAuth, requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";

/** Routes for the compact signed-in dashboard: announcements, trending Ideas, active Spaces, and search. */
export function discoveryRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/discover/announcements", async (context) => {
    const { db } = context.get("database");
    const rows = await db.select().from(announcements)
      .where(and(sql`${announcements.startsAt} <= now()`, or(isNull(announcements.endsAt), sql`${announcements.endsAt} > now()`)))
      .orderBy(desc(announcements.priority), desc(announcements.startsAt)).limit(10);
    return context.json({ items: rows });
  });

  app.use("/discover/ideas", optionalAuth);
  app.get("/discover/ideas", async (context) => {
    const { db } = context.get("database");
    const category = context.req.query("category");
    const viewerId = context.get("auth")?.userId;
    const rows = await db.select({
      id: ideas.id, title: ideas.title, body: ideas.body, category: ideas.category, lookingFor: ideas.lookingFor,
      lifecycle: ideas.lifecycle, authorUserId: ideas.authorUserId, createdAt: ideas.createdAt,
      interestCount: sql<number>`count(${ideaInterests.userId})::int`,
    }).from(ideas).leftJoin(ideaInterests, eq(ideaInterests.ideaId, ideas.id))
      .where(and(eq(ideas.isPublic, true), category ? eq(ideas.category, category) : undefined))
      .groupBy(ideas.id).orderBy(desc(sql`count(${ideaInterests.userId})`), desc(ideas.createdAt)).limit(30);
    const bookmarks = viewerId ? await db.select({ ideaId: sql<string>`${ideas.id}` }).from(ideas)
      .where(sql`false`) : []; // Bookmarked IDs are loaded by the dedicated user route to keep dashboard reads cheap.
    return context.json({ items: rows, bookmarkedIdeaIds: bookmarks.map((item) => item.ideaId) });
  });

  app.get("/discover/spaces", async (context) => {
    const { db } = context.get("database");
    const topic = context.req.query("topic");
    const type = context.req.query("type");
    const rows = await db.select({
      id: spaces.id, slug: spaces.slug, name: spaces.name, summary: spaces.summary, category: spaces.category,
      type: spaces.type, recruiting: spaces.recruiting, maxMembers: spaces.maxMembers, createdAt: spaces.createdAt,
      memberCount: sql<number>`count(${spaceMemberships.userId}) filter (where ${spaceMemberships.status} = 'active')::int`,
    }).from(spaces).leftJoin(spaceMemberships, eq(spaceMemberships.spaceId, spaces.id))
      .where(and(eq(spaces.visibility, "public"), isNull(spaces.archivedAt), topic ? eq(spaces.category, topic) : undefined, type ? eq(spaces.type, type as typeof spaces.type.enumValues[number]) : undefined))
      .groupBy(spaces.id).orderBy(desc(spaces.createdAt)).limit(30);
    return context.json({ items: rows });
  });

  app.use("/discover/following", requireAuth);
  app.get("/discover/following", async (context) => {
    const { db } = context.get("database");
    const rows = await db.select({ slug: spaces.slug, name: spaces.name, summary: spaces.summary, followedAt: spaceFollows.createdAt })
      .from(spaceFollows).innerJoin(spaces, eq(spaceFollows.spaceId, spaces.id))
      .where(eq(spaceFollows.userId, currentUserId(context))).orderBy(desc(spaceFollows.createdAt));
    return context.json({ items: rows });
  });

  app.get("/search", async (context) => {
    const { db } = context.get("database");
    const query = context.req.query("q")?.trim();
    if (!query || query.length < 2) return context.json({ items: [] });
    const pattern = `%${query}%`;
    const [ideaRows, spaceRows] = await Promise.all([
      db.select({ kind: sql<string>`'Idea'`, id: ideas.id, name: ideas.title, detail: ideas.category }).from(ideas)
        .where(and(eq(ideas.isPublic, true), or(ilike(ideas.title, pattern), ilike(ideas.body, pattern)))).limit(10),
      db.select({ kind: sql<string>`'Space'`, id: spaces.id, name: spaces.name, detail: spaces.summary }).from(spaces)
        .where(and(eq(spaces.visibility, "public"), isNull(spaces.archivedAt), or(ilike(spaces.name, pattern), ilike(spaces.summary, pattern)))).limit(10),
    ]);
    return context.json({ items: [...ideaRows, ...spaceRows] });
  });

  return app;
}
