/**
 * Buildspace API module: src/modules/calls/routes.ts
 * Creates Space calls and issues short-lived server-side LiveKit access tokens to authorised participants.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  callParticipants,
  callSessions,
  spaces,
  tasks,
  users,
} from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import { cleanText } from "../../lib/sanitize.js";
import { opaqueId } from "../../lib/ids.js";
import type { AppEnv } from "../../types.js";
import { createLiveKitToken, liveKitConfigured } from "../../providers/livekit.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const callInput = z.object({
  title: z.string().trim().min(2).max(180),
  taskId: z.string().uuid().optional(),
  startsAt: z.string().datetime().optional(),
});

export function callRoutes() {
  const app = new Hono<AppEnv>();
  // Call endpoints require a signed-in user.
  app.use("/*", requireAuth);

  // List all calls that belong to a Space.
  app.get("/spaces/:slug/calls", async (context) => {
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "calls:view"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Call access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const items = await context
      .get("database")
      .db.select()
      .from(callSessions)
      .where(eq(callSessions.spaceId, access!.spaceId))
      .orderBy(callSessions.createdAt);
    return context.json({ items });
  });
  // Schedule or start a new call.
  app.post("/spaces/:slug/calls", async (context) => {
    const parsed = callInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "calls:start"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Call access is required.",
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
            message: "Call details are invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const [call] = await context
      .get("database")
      .db.insert(callSessions)
      .values({
        spaceId: access!.spaceId,
        startedByUserId: currentUserId(context),
        title: cleanText(parsed.data.title, 180),
        taskId: parsed.data.taskId ?? null,
        livekitRoom: `space-${access!.spaceId}-${opaqueId("call")}`,
        status: parsed.data.startsAt ? "scheduled" : "live",
        startedAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(),
      })
      .returning();
    return context.json({ call }, 201);
  });
  // Issue a short-lived LiveKit token so a participant can join the room.
  app.post("/calls/:callId/join", async (context) => {
    const { db } = context.get("database");
    const call = (
      await db
        .select()
        .from(callSessions)
        .where(eq(callSessions.id, context.req.param("callId")))
        .limit(1)
    )[0];
    if (!call)
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Call not found.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    const spaceAccess = await db
      .select({ slug: spaces.slug })
      .from(spaces)
      .where(eq(spaces.id, call.spaceId))
      .limit(1);
    const access = spaceAccess[0]
      ? await resolveSpaceAccess(
          context.get("database"),
          spaceAccess[0].slug,
          currentUserId(context),
        )
      : null;
    if (!canAccess(access, currentUserId(context), "calls:join"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Call access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const config = context.get("config");
    if (!liveKitConfigured(config))
      return context.json(
        {
          error: {
            code: "CALLS_UNCONFIGURED",
            message: "LiveKit credentials have not been configured.",
            requestId: context.get("requestId"),
          },
        },
        503,
      );
    const user = context.get("auth")!;
    const token = await createLiveKitToken(config, {
      room: call.livekitRoom,
      userId: user.userId,
      displayName: user.displayName,
    });
    await db
      .insert(callParticipants)
      .values({ callSessionId: call.id, userId: user.userId })
      .onConflictDoNothing();
    if (call.status === "scheduled")
      await db
        .update(callSessions)
        .set({ status: "live", startedAt: new Date() })
        .where(eq(callSessions.id, call.id));
    return context.json({ room: call.livekitRoom, serverUrl: config.LIVEKIT_URL, token });
  });
  // End a call, but only the person who started it may do so.
  app.post("/calls/:callId/end", async (context) => {
    const { db } = context.get("database");
    const call = (
      await db
        .select()
        .from(callSessions)
        .where(eq(callSessions.id, context.req.param("callId")))
        .limit(1)
    )[0];
    if (!call || call.startedByUserId !== currentUserId(context))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only the call starter can end this call.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    await db
      .update(callSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(callSessions.id, call.id));
    return context.body(null, 204);
  });
  return app;
}
