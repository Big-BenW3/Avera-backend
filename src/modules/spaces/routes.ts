/**
 * Buildspace API module: src/modules/spaces/routes.ts
 * Implements Space creation, team membership, invites, settings, overview, and collaboration controls.
 */

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  activityEvents,
  joinRequests,
  spaceBans,
  spaceFollows,
  spaceInvites,
  spaceMemberships,
  spaceRoles,
  spaces,
  tasks,
} from "../../db/schema.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { uuidParam, validationError } from "../../lib/http.js";
import { cleanText, isSafeExternalUrl } from "../../lib/sanitize.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { recordActivity } from "../activity/service.js";
import { canAccess, resolveSpaceAccess } from "./access.js";

const spaceInput = z.object({
  name: z.string().trim().min(2).max(140),
  summary: z.string().trim().min(10).max(500),
  category: z.string().trim().min(2).max(80),
  type: z.enum(["startup", "hackathon", "open_source", "client_project", "personal", "experiment"]),
  visibility: z.enum(["public", "private"]).default("private"),
  recruiting: z.boolean().default(false),
  productStage: z.string().trim().max(48).default("exploring"),
  maxMembers: z.number().int().min(1).max(20).default(5),
});
const settingsInput = z.object({
  summary: z.string().trim().min(10).max(500).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  recruiting: z.boolean().optional(),
  externalUrl: z.string().url().nullable().optional(),
  category: z.string().trim().min(2).max(80).optional(),
});
const inviteInput = z.object({
  email: z.string().email().max(320),
  roleId: z.string().uuid().nullable().optional(),
});
const joinRequestInput = z.object({
  desiredRole: z.string().trim().max(100).optional(),
  note: z.string().trim().max(1200).optional(),
});
const reviewJoinInput = z.object({
  status: z.enum(["accepted", "declined"]),
  roleId: z.string().uuid().nullable().optional(),
});
const timeboxInput = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reminderEnabled: z.boolean().default(true),
});

// Small helper that writes the standard error envelope without repeating it everywhere.
function error(
  context: { json: Function; get(name: "requestId"): string },
  code: string,
  message: string,
  status: 400 | 403 | 404,
) {
  return context.json({ error: { code, message, requestId: context.get("requestId") } }, status);
}

// Resolve the Space from the :slug param and check the user has the requested permission.
async function requireSpace(context: Parameters<typeof currentUserId>[0], permission?: string) {
  const access = await resolveSpaceAccess(
    context.get("database"),
    context.req.param("slug") ?? "",
    currentUserId(context),
  );
  return canAccess(access, currentUserId(context), permission) ? access : null;
}

export function spaceRoutes() {
  const app = new Hono<AppEnv>();

  app.use("/*", requireAuth);

  // Create a Space, add the creator as the owner with full permissions, and log activity.
  app.post("/spaces", async (context) => {
    const parsed = spaceInput.safeParse(await context.req.json());
    if (!parsed.success)
      return error(context, "VALIDATION_ERROR", "Space details are invalid.", 400);
    const input = {
      ...parsed.data,
      name: cleanText(parsed.data.name, 140),
      summary: cleanText(parsed.data.summary, 500),
      category: cleanText(parsed.data.category, 80),
      productStage: cleanText(parsed.data.productStage, 48),
    };
    const owner = currentUserId(context);
    const baseSlug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 70);
    const slug = `${baseSlug}-${randomToken(5).toLowerCase()}`;
    const { db } = context.get("database");
    const result = await db.transaction(async (transaction) => {
      const [space] = await transaction
        .insert(spaces)
        .values({ ...input, ownerUserId: owner, slug })
        .returning();
      const [ownerRole] = await transaction
        .insert(spaceRoles)
        .values({ spaceId: space!.id, name: "Owner", isOwnerRole: true, permissions: ["*"] })
        .returning();
      await transaction.insert(spaceMemberships).values({
        spaceId: space!.id,
        userId: owner,
        roleId: ownerRole!.id,
        status: "active",
        joinedAt: new Date(),
      });
      return space!;
    });
    await recordActivity(context.get("database"), {
      spaceId: result.id,
      actorUserId: owner,
      type: "space.created",
      entityType: "space",
      entityId: result.id,
      payload: { name: result.name },
    });
    return context.json({ space: result }, 201);
  });

  // View a Space along with its active members (private Spaces need access).
  app.get("/spaces/:slug", async (context) => {
    const { db } = context.get("database");
    const space = (
      await db
        .select()
        .from(spaces)
        .where(eq(spaces.slug, context.req.param("slug") ?? ""))
        .limit(1)
    )[0];
    if (!space || space.archivedAt) return error(context, "NOT_FOUND", "Space not found.", 404);
    const access = await resolveSpaceAccess(
      context.get("database"),
      space.slug,
      currentUserId(context),
    );
    if (space.visibility === "private" && !canAccess(access, currentUserId(context)))
      return error(context, "FORBIDDEN", "You do not have access to this Space.", 403);
    const members = await db
      .select({
        userId: spaceMemberships.userId,
        roleId: spaceMemberships.roleId,
        status: spaceMemberships.status,
        joinedAt: spaceMemberships.joinedAt,
      })
      .from(spaceMemberships)
      .where(and(eq(spaceMemberships.spaceId, space.id), eq(spaceMemberships.status, "active")));
    return context.json({ space, members, permissions: access?.permissions ?? [] });
  });

  // Compact overview: task progress plus the latest activity entries.
  app.get("/spaces/:slug/overview", async (context) => {
    const access = await requireSpace(context, "space:view");
    if (!access) return error(context, "FORBIDDEN", "Space membership is required.", 403);
    const { db } = context.get("database");
    const [taskStats] = await db
      .select({
        total: count(tasks.id),
        done: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(tasks)
      .where(eq(tasks.spaceId, access.spaceId));
    const latestActivity = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.spaceId, access.spaceId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(6);
    return context.json({
      spaceId: access.spaceId,
      taskStats: { total: taskStats?.total ?? 0, done: taskStats?.done ?? 0 },
      latestActivity,
    });
  });

  // Update Space settings (summary, visibility, recruiting, category, URL).
  app.patch("/spaces/:slug/settings", async (context) => {
    const access = await requireSpace(context, "space:manage");
    if (!access)
      return error(context, "FORBIDDEN", "Only Space owners or managers can update settings.", 403);
    const parsed = settingsInput.safeParse(await context.req.json());
    if (!parsed.success) return error(context, "VALIDATION_ERROR", "Settings are invalid.", 400);
    if (!isSafeExternalUrl(parsed.data.externalUrl ?? null))
      return error(context, "VALIDATION_ERROR", "External URL must be http(s).", 400);
    const [space] = await context
      .get("database")
      .db.update(spaces)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(spaces.id, access.spaceId))
      .returning();
    await recordActivity(context.get("database"), {
      spaceId: access.spaceId,
      actorUserId: currentUserId(context),
      type: "space.settings_updated",
      entityType: "space",
      entityId: access.spaceId,
    });
    return context.json({ space });
  });

  // Follow a public Space (no-op if already following).
  app.post("/spaces/:slug/follow", async (context) => {
    const { db } = context.get("database");
    const space = (
      await db
        .select({ id: spaces.id, visibility: spaces.visibility })
        .from(spaces)
        .where(eq(spaces.slug, context.req.param("slug") ?? ""))
        .limit(1)
    )[0];
    if (!space || space.visibility !== "public")
      return error(context, "NOT_FOUND", "Public Space not found.", 404);
    await db
      .insert(spaceFollows)
      .values({ spaceId: space.id, userId: currentUserId(context) })
      .onConflictDoNothing();
    return context.body(null, 204);
  });
  // Stop following a Space.
  app.delete("/spaces/:slug/follow", async (context) => {
    const { db } = context.get("database");
    const space = (
      await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.slug, context.req.param("slug") ?? ""))
        .limit(1)
    )[0];
    if (space)
      await db
        .delete(spaceFollows)
        .where(
          and(eq(spaceFollows.spaceId, space.id), eq(spaceFollows.userId, currentUserId(context))),
        );
    return context.body(null, 204);
  });

  // Invite someone by email; the one-time acceptance token is returned so it can be emailed.
  app.post("/spaces/:slug/invites", async (context) => {
    const access = await requireSpace(context, "members:invite");
    if (!access)
      return error(context, "FORBIDDEN", "You cannot invite members to this Space.", 403);
    const parsed = inviteInput.safeParse(await context.req.json());
    if (!parsed.success)
      return error(context, "VALIDATION_ERROR", "Invite details are invalid.", 400);
    const rawToken = randomToken();
    const [invite] = await context
      .get("database")
      .db.insert(spaceInvites)
      .values({
        spaceId: access.spaceId,
        inviterUserId: currentUserId(context),
        recipientEmail: parsed.data.email.toLowerCase(),
        roleId: parsed.data.roleId ?? null,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    // The raw token is shown once so a worker can email it. Only its hash is persisted.
    return context.json({ invite, acceptanceToken: rawToken }, 201);
  });

  // Ask to join a public Space that is currently recruiting.
  app.post("/spaces/:slug/join-requests", async (context) => {
    const parsed = joinRequestInput.safeParse(await context.req.json());
    if (!parsed.success) return error(context, "VALIDATION_ERROR", "Join request is invalid.", 400);
    const { db } = context.get("database");
    const space = (
      await db
        .select({ id: spaces.id, recruiting: spaces.recruiting, visibility: spaces.visibility })
        .from(spaces)
        .where(eq(spaces.slug, context.req.param("slug") ?? ""))
        .limit(1)
    )[0];
    if (!space || space.visibility !== "public" || !space.recruiting)
      return error(context, "NOT_FOUND", "This Space is not accepting requests.", 404);
    const [request] = await db
      .insert(joinRequests)
      .values({ spaceId: space.id, userId: currentUserId(context), ...parsed.data })
      .onConflictDoNothing()
      .returning();
    return context.json({ request }, 201);
  });

  // Accept or decline a pending join request.
  app.patch("/spaces/:slug/join-requests/:requestId", async (context) => {
    const access = await requireSpace(context, "members:manage");
    if (!access) return error(context, "FORBIDDEN", "You cannot review join requests.", 403);
    const parsed = reviewJoinInput.safeParse(await context.req.json());
    if (!parsed.success)
      return error(context, "VALIDATION_ERROR", "Review details are invalid.", 400);
    const { db } = context.get("database");
    const [request] = await db
      .select()
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.id, context.req.param("requestId")),
          eq(joinRequests.spaceId, access.spaceId),
        ),
      )
      .limit(1);
    if (!request || request.status !== "pending")
      return error(context, "NOT_FOUND", "Pending join request not found.", 404);
    await db.transaction(async (transaction) => {
      await transaction
        .update(joinRequests)
        .set({
          status: parsed.data.status,
          reviewedByUserId: currentUserId(context),
          reviewedAt: new Date(),
        })
        .where(eq(joinRequests.id, request.id));
      if (parsed.data.status === "accepted")
        await transaction
          .insert(spaceMemberships)
          .values({
            spaceId: access.spaceId,
            userId: request.userId,
            roleId: parsed.data.roleId ?? null,
            status: "active",
            joinedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [spaceMemberships.spaceId, spaceMemberships.userId],
            set: {
              status: "active",
              roleId: parsed.data.roleId ?? null,
              joinedAt: new Date(),
              removedAt: null,
            },
          });
    });
    await recordActivity(context.get("database"), {
      spaceId: access.spaceId,
      actorUserId: currentUserId(context),
      type: `join_request.${parsed.data.status}`,
      entityType: "join_request",
      entityId: request.id,
      payload: { userId: request.userId },
    });
    return context.json({ status: parsed.data.status });
  });

  // Ban a member: record the ban and remove their membership at the same time.
  app.post("/spaces/:slug/bans/:userId", async (context) => {
    const access = await requireSpace(context, "members:manage");
    if (!access) return error(context, "FORBIDDEN", "You cannot ban Space members.", 403);
    const target = uuidParam(context, "userId");
    if (!target) return validationError(context, "User ID is invalid.");
    await context.get("database").db.transaction(async (transaction) => {
      await transaction
        .insert(spaceBans)
        .values({
          spaceId: access.spaceId,
          userId: target,
          createdByUserId: currentUserId(context),
        })
        .onConflictDoNothing();
      await transaction
        .update(spaceMemberships)
        .set({ status: "removed", removedAt: new Date() })
        .where(
          and(eq(spaceMemberships.spaceId, access.spaceId), eq(spaceMemberships.userId, target)),
        );
    });
    return context.body(null, 204);
  });

  return app;
}
