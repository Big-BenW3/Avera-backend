/**
 * Buildspace API module: src/openapi.ts
 * Generates the maintained API inventory that the separately deployed Next.js frontend integrates against.
 */

import { writeFile } from "node:fs/promises";

/**
 * The API repositories are deliberately separate. This maintained OpenAPI inventory
 * is the wire contract the Next.js repository consumes; route code remains typed
 * internally with Zod. Add every new route here in the same pull request.
 *
 * Every POST/PATCH/PUT carries `body` so Swagger UI renders a request body.
 * GETs with filters carry `query`; path params carry `params`.
 */
type Schema = Record<string, unknown>;
type Param = { name: string; schema: Schema; required?: boolean };
type Route = {
  method: string;
  path: string;
  summary: string;
  tags: string[];
  auth?: boolean;
  body?: Schema;
  query?: Param[];
  params?: Param[];
};

const uuid = { type: "string", format: "uuid" } as const;
const slugParam = { name: "slug", schema: { type: "string" } } as Param;
const ideaIdParam = { name: "ideaId", schema: uuid } as Param;
const taskIdParam = { name: "taskId", schema: uuid } as Param;

const signUpBody = {
  type: "object",
  required: ["email", "password", "displayName", "handle"],
  properties: {
    email: { type: "string", format: "email", maxLength: 320 },
    password: { type: "string", minLength: 12, maxLength: 256 },
    displayName: { type: "string", minLength: 2, maxLength: 120 },
    handle: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{2,39}$" },
  },
};
const signInBody = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email", maxLength: 320 },
    password: { type: "string", minLength: 1, maxLength: 256 },
  },
};
const mfaVerifyBody = {
  type: "object",
  required: ["ticket", "code"],
  properties: { ticket: { type: "string" }, code: { type: "string", pattern: "^\\d{6}$" } },
};
const profileBody = {
  type: "object",
  required: ["displayName"],
  properties: {
    displayName: { type: "string", minLength: 2, maxLength: 120 },
    bio: { type: ["string", "null"], maxLength: 500 },
    skills: { type: "array", maxItems: 20, items: { type: "string", maxLength: 50 } },
  },
};
const mfaCodeBody = {
  type: "object",
  required: ["code"],
  properties: { code: { type: "string", pattern: "^\\d{6}$" } },
};
const forgotBody = {
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email", maxLength: 320 } },
};
const resetBody = {
  type: "object",
  required: ["ticket", "password"],
  properties: {
    ticket: { type: "string" },
    password: { type: "string", minLength: 12, maxLength: 256 },
  },
};
const ideaBody = {
  type: "object",
  required: ["title", "body", "category"],
  properties: {
    title: { type: "string", minLength: 4, maxLength: 180 },
    body: { type: "string", minLength: 20, maxLength: 6000 },
    category: { type: "string", minLength: 2, maxLength: 80 },
    lookingFor: { type: "string", maxLength: 120 },
  },
};
const offerBody = {
  type: "object",
  required: ["offer"],
  properties: {
    offer: { type: "string", minLength: 5, maxLength: 1000 },
    availability: { type: "string", maxLength: 80 },
  },
};
const commentBody = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string", minLength: 1, maxLength: 4000 } },
};
const promoteBody = {
  type: "object",
  required: ["name", "summary", "type"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 140 },
    summary: { type: "string", minLength: 10, maxLength: 500 },
    type: {
      type: "string",
      enum: ["startup", "hackathon", "open_source", "client_project", "personal", "experiment"],
    },
    visibility: { type: "string", enum: ["public", "private"], default: "private" },
  },
};
const spaceBody = {
  type: "object",
  required: ["name", "summary", "category", "type"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 140 },
    summary: { type: "string", minLength: 10, maxLength: 500 },
    category: { type: "string", minLength: 2, maxLength: 80 },
    type: {
      type: "string",
      enum: ["startup", "hackathon", "open_source", "client_project", "personal", "experiment"],
    },
    visibility: { type: "string", enum: ["public", "private"], default: "private" },
    recruiting: { type: "boolean", default: false },
    productStage: { type: "string", maxLength: 48, default: "exploring" },
    maxMembers: { type: "integer", minimum: 1, maximum: 20, default: 5 },
  },
};
const spaceSettingsBody = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 10, maxLength: 500 },
    visibility: { type: "string", enum: ["public", "private"] },
    recruiting: { type: "boolean" },
    externalUrl: { type: ["string", "null"], format: "uri" },
    category: { type: "string", minLength: 2, maxLength: 80 },
  },
};
const inviteBody = {
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email", maxLength: 320 }, roleId: uuid },
};
const joinRequestBody = {
  type: "object",
  properties: {
    desiredRole: { type: "string", maxLength: 100 },
    note: { type: "string", maxLength: 1200 },
  },
};
const reviewJoinBody = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string", enum: ["accepted", "declined"] }, roleId: uuid },
};
const noteBody = {
  type: "object",
  required: ["title", "body"],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 180 },
    body: { type: "string", minLength: 1, maxLength: 4000 },
    color: { type: "string", enum: ["yellow", "blue", "red", "green"], default: "yellow" },
  },
};
const roadmapBody = {
  type: "object",
  required: ["horizon", "title"],
  properties: {
    horizon: { type: "string", enum: ["now", "next", "later"] },
    title: { type: "string", minLength: 2, maxLength: 180 },
    description: { type: "string", maxLength: 2000 },
    position: { type: "integer", minimum: 0 },
  },
};
const taskBody = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 180 },
    description: { type: "string", maxLength: 6000 },
    area: { type: "string", default: "Product" },
    priority: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
    assigneeUserId: uuid,
    roadmapItemId: uuid,
    dueAt: { type: "string", format: "date-time" },
  },
};
const taskPatchBody = {
  type: "object",
  properties: {
    ...(taskBody.properties as Record<string, unknown>),
    status: { type: "string", enum: ["todo", "in_progress", "done"] },
    position: { type: "integer", minimum: 0 },
  },
};
const chatBody = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string", minLength: 1, maxLength: 8000 }, replyToMessageId: uuid },
};
const dmRequestBody = {
  type: "object",
  required: ["recipientUserId", "body"],
  properties: { recipientUserId: uuid, body: { type: "string", minLength: 1, maxLength: 2000 } },
};
const dmReviewBody = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string", enum: ["accepted", "declined"] } },
};
const callBody = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 180 },
    taskId: uuid,
    startsAt: { type: "string", format: "date-time" },
  },
};
const aiSettingsBody = {
  type: "object",
  required: ["enabledSources", "chatExcluded"],
  properties: {
    enabledSources: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: ["roadmap", "tasks", "activity", "design", "build"] },
    },
    chatExcluded: { type: "boolean", const: true },
  },
};
const aiRunBody = {
  type: "object",
  required: ["kind", "prompt"],
  properties: {
    kind: {
      type: "string",
      enum: ["planning_interview", "proposal", "summary", "task_breakdown", "memory_question"],
    },
    prompt: { type: "string", minLength: 1, maxLength: 12000 },
    sourceIds: { type: "array", maxItems: 30, items: uuid },
  },
};
const uploadBody = {
  type: "object",
  required: ["fileName", "contentType", "byteSize", "entityType", "entityId"],
  properties: {
    fileName: { type: "string", minLength: 1, maxLength: 255 },
    contentType: { type: "string", minLength: 3, maxLength: 160 },
    byteSize: { type: "integer", minimum: 1, maximum: 26214400 },
    entityType: { type: "string", enum: ["task", "planning_note", "design_link", "space"] },
    entityId: uuid,
  },
};
const designLinkBody = {
  type: "object",
  required: ["externalFileId", "url", "title"],
  properties: {
    externalFileId: { type: "string", minLength: 1, maxLength: 255 },
    url: { type: "string", format: "uri" },
    title: { type: "string", minLength: 1, maxLength: 180 },
  },
};
const reportBody = {
  type: "object",
  required: ["entityType", "entityId", "reason"],
  properties: {
    entityType: { type: "string", enum: ["idea", "space", "profile", "comment"] },
    entityId: uuid,
    reason: { type: "string", enum: ["spam", "harassment", "impersonation", "other"] },
    context: { type: "string", maxLength: 3000 },
  },
};

// Health and auth come first, then discovery/people/safety…
const routes: Route[] = [
  { method: "get", path: "/health/live", summary: "Process liveness", tags: ["Health"] },
  {
    method: "get",
    path: "/health/ready",
    summary: "PostgreSQL and Redis readiness",
    tags: ["Health"],
  },
  { method: "get", path: "/health/database", summary: "Database readiness", tags: ["Health"] },
  {
    method: "post",
    path: "/api/v1/auth/sign-up",
    summary: "Create a password account",
    tags: ["Auth"],
    body: signUpBody,
  },
  {
    method: "post",
    path: "/api/v1/auth/sign-in",
    summary: "Sign in or receive an MFA challenge",
    tags: ["Auth"],
    body: signInBody,
  },
  {
    method: "post",
    path: "/api/v1/auth/mfa/verify",
    summary: "Complete MFA sign-in",
    tags: ["Auth"],
    body: mfaVerifyBody,
  },
  {
    method: "get",
    path: "/api/v1/auth/me",
    summary: "Current account",
    tags: ["Auth"],
    auth: true,
  },
  {
    method: "post",
    path: "/api/v1/auth/sign-out",
    summary: "Revoke browser session",
    tags: ["Auth"],
    auth: true,
  },
  {
    method: "patch",
    path: "/api/v1/auth/profile",
    summary: "Update profile",
    tags: ["Auth"],
    auth: true,
    body: profileBody,
  },
  {
    method: "post",
    path: "/api/v1/auth/mfa/enroll",
    summary: "Start TOTP enrollment",
    tags: ["Auth"],
    auth: true,
  },
  {
    method: "post",
    path: "/api/v1/auth/mfa/confirm",
    summary: "Confirm TOTP factor",
    tags: ["Auth"],
    auth: true,
    body: mfaCodeBody,
  },
  {
    method: "post",
    path: "/api/v1/auth/password/forgot",
    summary: "Request a password-reset ticket",
    tags: ["Auth"],
    body: forgotBody,
  },
  {
    method: "post",
    path: "/api/v1/auth/password/reset",
    summary: "Reset password with a ticket",
    tags: ["Auth"],
    body: resetBody,
  },
  {
    method: "get",
    path: "/api/v1/discover/announcements",
    summary: "Active dashboard announcements",
    tags: ["Discovery"],
  },
  {
    method: "get",
    path: "/api/v1/discover/ideas",
    summary: "Trending public Ideas",
    tags: ["Discovery"],
    auth: true,
    query: [{ name: "category", schema: { type: "string" } }],
  },
  {
    method: "get",
    path: "/api/v1/discover/spaces",
    summary: "Public active Spaces",
    tags: ["Discovery"],
    auth: true,
    query: [
      { name: "topic", schema: { type: "string" } },
      { name: "type", schema: { type: "string" } },
    ],
  },
  {
    method: "get",
    path: "/api/v1/discover/following",
    summary: "Followed Spaces",
    tags: ["Discovery"],
    auth: true,
  },
  {
    method: "get",
    path: "/api/v1/search",
    summary: "Search public Ideas and Spaces",
    tags: ["Discovery"],
    auth: true,
    query: [{ name: "q", schema: { type: "string" }, required: true }],
  },
  {
    method: "get",
    path: "/api/v1/people",
    summary: "People directory",
    tags: ["People"],
    auth: true,
    query: [{ name: "q", schema: { type: "string" } }],
  },
  {
    method: "get",
    path: "/api/v1/people/{handle}",
    summary: "Public profile",
    tags: ["People"],
    auth: true,
    params: [{ name: "handle", schema: { type: "string" } }],
  },
  {
    method: "post",
    path: "/api/v1/me/blocks/{userId}",
    summary: "Block a user",
    tags: ["Safety"],
    auth: true,
    params: [{ name: "userId", schema: uuid }],
  },
  {
    method: "delete",
    path: "/api/v1/me/blocks/{userId}",
    summary: "Unblock a user",
    tags: ["Safety"],
    auth: true,
    params: [{ name: "userId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/reports",
    summary: "Report public content",
    tags: ["Safety"],
    auth: true,
    body: reportBody,
  },
  {
    method: "get",
    path: "/api/v1/ideas/{ideaId}",
    summary: "Idea detail and visible comments",
    tags: ["Ideas"],
    auth: true,
    params: [ideaIdParam],
  },
  {
    method: "post",
    path: "/api/v1/ideas",
    summary: "Create an Idea",
    tags: ["Ideas"],
    auth: true,
    body: ideaBody,
  },
  ...["bookmark", "interest"].flatMap((action) => [
    {
      method: "post",
      path: `/api/v1/ideas/{ideaId}/${action}`,
      summary: `Add ${action}`,
      tags: ["Ideas"],
      auth: true,
      params: [ideaIdParam],
    },
    {
      method: "delete",
      path: `/api/v1/ideas/{ideaId}/${action}`,
      summary: `Remove ${action}`,
      tags: ["Ideas"],
      auth: true,
      params: [ideaIdParam],
    },
  ]),
  {
    method: "post",
    path: "/api/v1/ideas/{ideaId}/offers",
    summary: "Offer to help",
    tags: ["Ideas"],
    auth: true,
    params: [ideaIdParam],
    body: offerBody,
  },
  {
    method: "get",
    path: "/api/v1/ideas/{ideaId}/offers",
    summary: "Creator-only offers",
    tags: ["Ideas"],
    auth: true,
    params: [ideaIdParam],
  },
  {
    method: "post",
    path: "/api/v1/ideas/{ideaId}/comments",
    summary: "Comment on an Idea",
    tags: ["Ideas"],
    auth: true,
    params: [ideaIdParam],
    body: commentBody,
  },
  {
    method: "post",
    path: "/api/v1/ideas/{ideaId}/comments/{commentId}/hide",
    summary: "Hide a comment",
    tags: ["Ideas"],
    auth: true,
    params: [ideaIdParam, { name: "commentId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/ideas/{ideaId}/promote",
    summary: "Create a Space from an Idea",
    tags: ["Ideas", "Spaces"],
    auth: true,
    params: [ideaIdParam],
    body: promoteBody,
  },
  {
    method: "post",
    path: "/api/v1/spaces",
    summary: "Create a Space",
    tags: ["Spaces"],
    auth: true,
    body: spaceBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}",
    summary: "Space and team",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/overview",
    summary: "Compact workspace overview",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "patch",
    path: "/api/v1/spaces/{slug}/settings",
    summary: "Update Space settings",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam],
    body: spaceSettingsBody,
  },
  ...["follow"].flatMap((action) => [
    {
      method: "post",
      path: `/api/v1/spaces/{slug}/${action}`,
      summary: "Follow public Space",
      tags: ["Spaces"],
      auth: true,
      params: [slugParam],
    },
    {
      method: "delete",
      path: `/api/v1/spaces/{slug}/${action}`,
      summary: "Unfollow public Space",
      tags: ["Spaces"],
      auth: true,
      params: [slugParam],
    },
  ]),
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/invites",
    summary: "Create invite",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam],
    body: inviteBody,
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/join-requests",
    summary: "Request to join",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam],
    body: joinRequestBody,
  },
  {
    method: "patch",
    path: "/api/v1/spaces/{slug}/join-requests/{requestId}",
    summary: "Review join request",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam, { name: "requestId", schema: uuid }],
    body: reviewJoinBody,
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/bans/{userId}",
    summary: "Ban member",
    tags: ["Spaces"],
    auth: true,
    params: [slugParam, { name: "userId", schema: uuid }],
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/planning-notes",
    summary: "List planning-notes",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/planning-notes",
    summary: "Create planning-notes",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
    body: noteBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/roadmap-items",
    summary: "List roadmap-items",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/roadmap-items",
    summary: "Create roadmap-items",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
    body: roadmapBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/tasks",
    summary: "List tasks",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/tasks",
    summary: "Create tasks",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
    body: taskBody,
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/planning-notes/{noteId}/promote",
    summary: "Promote note to task",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam, { name: "noteId", schema: uuid }],
  },
  {
    method: "get",
    path: "/api/v1/tasks/{taskId}",
    summary: "Task detail",
    tags: ["Workspace"],
    auth: true,
    params: [taskIdParam],
  },
  {
    method: "patch",
    path: "/api/v1/tasks/{taskId}",
    summary: "Update task or board state",
    tags: ["Workspace"],
    auth: true,
    params: [taskIdParam],
    body: taskPatchBody,
  },
  {
    method: "post",
    path: "/api/v1/tasks/{taskId}/comments",
    summary: "Comment on task",
    tags: ["Workspace"],
    auth: true,
    params: [taskIdParam],
    body: commentBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/activity",
    summary: "Space activity feed",
    tags: ["Workspace"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/chat",
    summary: "Space chat history",
    tags: ["Chat"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/chat/messages",
    summary: "Send Space chat message",
    tags: ["Chat"],
    auth: true,
    params: [slugParam],
    body: chatBody,
  },
  {
    method: "post",
    path: "/api/v1/dm/requests",
    summary: "Send direct-message request",
    tags: ["Chat"],
    auth: true,
    body: dmRequestBody,
  },
  {
    method: "get",
    path: "/api/v1/dm/requests",
    summary: "Message requests",
    tags: ["Chat"],
    auth: true,
  },
  {
    method: "patch",
    path: "/api/v1/dm/requests/{requestId}",
    summary: "Accept or decline message request",
    tags: ["Chat"],
    auth: true,
    params: [{ name: "requestId", schema: uuid }],
    body: dmReviewBody,
  },
  {
    method: "get",
    path: "/api/v1/dm/conversations",
    summary: "Direct conversations",
    tags: ["Chat"],
    auth: true,
  },
  {
    method: "get",
    path: "/api/v1/conversations/{conversationId}/messages",
    summary: "Direct message history",
    tags: ["Chat"],
    auth: true,
    params: [{ name: "conversationId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/conversations/{conversationId}/messages",
    summary: "Send direct message",
    tags: ["Chat"],
    auth: true,
    params: [{ name: "conversationId", schema: uuid }],
    body: chatBody,
  },
  {
    method: "post",
    path: "/api/v1/messages/{messageId}/read",
    summary: "Mark message read",
    tags: ["Chat"],
    auth: true,
    params: [{ name: "messageId", schema: uuid }],
  },
  {
    method: "get",
    path: "/api/v1/notifications",
    summary: "Notifications",
    tags: ["Notifications"],
    auth: true,
    query: [{ name: "unread", schema: { type: "string", enum: ["true", "false"] } }],
  },
  {
    method: "post",
    path: "/api/v1/notifications/{notificationId}/read",
    summary: "Mark notification read",
    tags: ["Notifications"],
    auth: true,
    params: [{ name: "notificationId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/notifications/read-all",
    summary: "Mark all notifications read",
    tags: ["Notifications"],
    auth: true,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/calls",
    summary: "List calls",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/calls",
    summary: "Schedule or start a call",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
    body: callBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/ai/settings",
    summary: "Read ai/settings",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "put",
    path: "/api/v1/spaces/{slug}/ai/settings",
    summary: "Update Project Memory settings",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
    body: aiSettingsBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/ai/runs",
    summary: "List AI runs",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/ai/runs",
    summary: "Queue an AI run",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
    body: aiRunBody,
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/integrations",
    summary: "List integrations",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "get",
    path: "/api/v1/spaces/{slug}/design-links",
    summary: "List design links",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/design-links",
    summary: "Add a Figma link",
    tags: ["Realtime and AI"],
    auth: true,
    params: [slugParam],
    body: designLinkBody,
  },
  {
    method: "post",
    path: "/api/v1/calls/{callId}/join",
    summary: "Issue LiveKit join token",
    tags: ["Calls"],
    auth: true,
    params: [{ name: "callId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/calls/{callId}/end",
    summary: "End call",
    tags: ["Calls"],
    auth: true,
    params: [{ name: "callId", schema: uuid }],
  },
  {
    method: "get",
    path: "/api/v1/ai/runs/{runId}",
    summary: "AI run and citations",
    tags: ["AI"],
    auth: true,
    params: [{ name: "runId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/spaces/{slug}/files/upload-url",
    summary: "Issue signed upload URL",
    tags: ["Files"],
    auth: true,
    params: [slugParam],
    body: uploadBody,
  },
  {
    method: "get",
    path: "/api/v1/files/{fileId}/download-url",
    summary: "Issue signed download URL",
    tags: ["Files"],
    auth: true,
    params: [{ name: "fileId", schema: uuid }],
  },
  {
    method: "post",
    path: "/api/v1/integrations/github/webhook",
    summary: "GitHub signed webhook receiver (HMAC verified, public)",
    tags: ["Integrations"],
  },
  {
    method: "get",
    path: "/api/v1/realtime",
    summary: "Authenticated WebSocket upgrade",
    tags: ["Realtime"],
    auth: true,
  },
];

// Group every route under its path and build the standard response codes.
const paths: Record<string, Record<string, unknown>> = {};
for (const route of routes) {
  const path = paths[route.path] ?? (paths[route.path] = {});
  const operation: Record<string, unknown> = {
    summary: route.summary,
    tags: route.tags,
    ...(route.auth ? { security: [{ sessionCookie: [] }] } : {}),
    responses: {
      "200": { description: "Successful response" },
      "201": { description: "Created" },
      "202": { description: "Accepted" },
      "204": { description: "No content" },
      "400": { description: "Validation error" },
      "401": { description: "Unauthenticated" },
      "403": { description: "Forbidden" },
      "404": { description: "Not found" },
      "429": { description: "Rate limited" },
      "503": { description: "Dependency not configured or unavailable" },
    },
  };
  if (route.params?.length || route.query?.length) {
    operation.parameters = [
      ...(route.params ?? []).map((p) => ({
        name: p.name,
        in: "path",
        required: true,
        schema: p.schema,
      })),
      ...(route.query ?? []).map((q) => ({
        name: q.name,
        in: "query",
        required: q.required ?? false,
        schema: q.schema,
      })),
    ];
  }
  if (route.body) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: route.body } },
    };
  }
  path[route.method] = operation;
}
// Assemble the full OpenAPI document and write it to openapi.json.
const document = {
  openapi: "3.1.0",
  info: {
    title: "Buildspace API",
    version: "0.1.0",
    description:
      "Separate standalone backend contract. Request bodies live in this inventory and mirror the Zod schemas in src/modules.",
  },
  servers: [{ url: "http://localhost:4000" }],
  tags: Array.from(new Set(routes.flatMap((route) => route.tags))).map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "buildspace_session" },
    },
  },
};
await writeFile("openapi.json", JSON.stringify(document, null, 2));
