/**
 * Buildspace API module: src/modules/chat/routes.ts
 * Persists Space chat, message requests, direct messages, and message receipts.
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  conversationMembers,
  conversations,
  messageReceipts,
  messageRequests,
  messages,
  spaceMemberships,
  spaces,
  userBlocks,
  users,
} from "../../db/schema.js";
import { requireAuth, currentUserId } from "../../middleware/auth.js";
import { cleanText } from "../../lib/sanitize.js";
import type { AppEnv } from "../../types.js";
import { canAccess, resolveSpaceAccess } from "../spaces/access.js";

const messageInput = z.object({
  body: z.string().trim().min(1).max(8000),
  replyToMessageId: z.string().uuid().optional(),
});
const messageRequestInput = z.object({
  recipientUserId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});
const reviewRequestInput = z.object({ status: z.enum(["accepted", "declined"]) });

async function memberOfConversation(
  context: Parameters<typeof currentUserId>[0],
  conversationId: string,
) {
  const rows = await context
    .get("database")
    .db.select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, currentUserId(context)),
        isNull(conversationMembers.leftAt),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function spaceConversation(
  context: Parameters<typeof currentUserId>[0],
  spaceId: string,
): Promise<string> {
  const { db } = context.get("database");
  const existing = (
    await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.kind, "space"), eq(conversations.spaceId, spaceId)))
      .limit(1)
  )[0];
  if (existing) return existing.id;
  const [conversation] = await db
    .insert(conversations)
    .values({ kind: "space", spaceId })
    .returning({ id: conversations.id });
  return conversation!.id;
}

/** Chats are persisted as durable records; clients read history directly. */
export function chatRoutes() {
  const app = new Hono<AppEnv>();
  app.use("/*", requireAuth);

  app.get("/spaces/:slug/chat", async (context) => {
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "chat:view"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Space chat access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const conversationId = await spaceConversation(context, access!.spaceId);
    const items = await context
      .get("database")
      .db.select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(100);
    return context.json({ conversationId, items: items.reverse() });
  });

  // Send a new message into the Space conversation.
  app.post("/spaces/:slug/chat/messages", async (context) => {
    const parsed = messageInput.safeParse(await context.req.json());
    const access = await resolveSpaceAccess(
      context.get("database"),
      context.req.param("slug"),
      currentUserId(context),
    );
    if (!canAccess(access, currentUserId(context), "chat:send"))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Space chat access is required.",
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
            message: "Message is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const conversationId = await spaceConversation(context, access!.spaceId);
    const [message] = await context
      .get("database")
      .db.insert(messages)
      .values({
        conversationId,
        authorUserId: currentUserId(context),
        body: cleanText(parsed.data.body, 8000),
        replyToMessageId: parsed.data.replyToMessageId ?? null,
      })
      .returning();
    return context.json({ message }, 201);
  });

  // Request to start a direct message conversation with another user.
  app.post("/dm/requests", async (context) => {
    const parsed = messageRequestInput.safeParse(await context.req.json());
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Message request is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const sender = currentUserId(context);
    if (sender === parsed.data.recipientUserId)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "You cannot message yourself.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const { db } = context.get("database");
    const blocked = await db
      .select()
      .from(userBlocks)
      .where(
        or(
          and(
            eq(userBlocks.blockerUserId, sender),
            eq(userBlocks.blockedUserId, parsed.data.recipientUserId),
          ),
          and(
            eq(userBlocks.blockerUserId, parsed.data.recipientUserId),
            eq(userBlocks.blockedUserId, sender),
          ),
        ),
      )
      .limit(1);
    if (blocked[0])
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "This message cannot be sent.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const [request] = await db
      .insert(messageRequests)
      .values({
        senderUserId: sender,
        recipientUserId: parsed.data.recipientUserId,
        body: cleanText(parsed.data.body, 2000),
      })
      .returning();
    return context.json({ request }, 201);
  });

  // List the message requests waiting for the signed-in user.
  app.get("/dm/requests", async (context) => {
    const items = await context
      .get("database")
      .db.select()
      .from(messageRequests)
      .where(eq(messageRequests.recipientUserId, currentUserId(context)))
      .orderBy(desc(messageRequests.createdAt));
    return context.json({ items });
  });

  // Accept or decline a waiting message request.
  app.patch("/dm/requests/:requestId", async (context) => {
    const parsed = reviewRequestInput.safeParse(await context.req.json());
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Review is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const { db } = context.get("database");
    const request = (
      await db
        .select()
        .from(messageRequests)
        .where(
          and(
            eq(messageRequests.id, context.req.param("requestId")),
            eq(messageRequests.recipientUserId, currentUserId(context)),
          ),
        )
        .limit(1)
    )[0];
    if (!request || request.status !== "pending")
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Pending message request not found.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    let conversationId: string | null = null;
    await db.transaction(async (transaction) => {
      if (parsed.data.status === "accepted") {
        const [conversation] = await transaction
          .insert(conversations)
          .values({ kind: "direct" })
          .returning({ id: conversations.id });
        conversationId = conversation!.id;
        await transaction.insert(conversationMembers).values([
          { conversationId, userId: request.senderUserId },
          { conversationId, userId: request.recipientUserId },
        ]);
        await transaction
          .insert(messages)
          .values({ conversationId, authorUserId: request.senderUserId, body: request.body });
      }
      await transaction
        .update(messageRequests)
        .set({ status: parsed.data.status, conversationId, updatedAt: new Date() })
        .where(eq(messageRequests.id, request.id));
    });
    return context.json({ status: parsed.data.status, conversationId });
  });

  // List the direct conversations the signed-in user is part of.
  app.get("/dm/conversations", async (context) => {
    const { db } = context.get("database");
    const membershipRows = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(
          eq(conversationMembers.userId, currentUserId(context)),
          eq(conversations.kind, "direct"),
          isNull(conversationMembers.leftAt),
        ),
      );
    const ids = membershipRows.map((row) => row.conversationId);
    if (ids.length === 0) return context.json({ items: [] });
    const items = await db
      .select()
      .from(conversations)
      .where(inArray(conversations.id, ids))
      .orderBy(desc(conversations.updatedAt));
    return context.json({ items });
  });

  // Read the message history for a direct conversation (newest 100, oldest first).
  app.get("/conversations/:conversationId/messages", async (context) => {
    const conversationId = context.req.param("conversationId");
    if (!(await memberOfConversation(context, conversationId)))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Conversation access is required.",
            requestId: context.get("requestId"),
          },
        },
        403,
      );
    const items = await context
      .get("database")
      .db.select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(100);
    return context.json({ items: items.reverse() });
  });

  // Send a direct message inside an existing conversation.
  app.post("/conversations/:conversationId/messages", async (context) => {
    const conversationId = context.req.param("conversationId");
    const parsed = messageInput.safeParse(await context.req.json());
    if (!(await memberOfConversation(context, conversationId)))
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Conversation access is required.",
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
            message: "Message is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const [message] = await context
      .get("database")
      .db.insert(messages)
      .values({
        conversationId,
        authorUserId: currentUserId(context),
        body: cleanText(parsed.data.body, 8000),
        replyToMessageId: parsed.data.replyToMessageId ?? null,
      })
      .returning();
    return context.json({ message }, 201);
  });

  // Mark a message as read by the signed-in user.
  app.post("/messages/:messageId/read", async (context) => {
    const { db } = context.get("database");
    const message = (
      await db
        .select()
        .from(messages)
        .where(eq(messages.id, context.req.param("messageId")))
        .limit(1)
    )[0];
    if (!message || !(await memberOfConversation(context, message.conversationId)))
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Message not found.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    await db
      .insert(messageReceipts)
      .values({
        messageId: message.id,
        userId: currentUserId(context),
        deliveredAt: new Date(),
        readAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [messageReceipts.messageId, messageReceipts.userId],
        set: { readAt: new Date() },
      });
    return context.body(null, 204);
  });

  return app;
}
