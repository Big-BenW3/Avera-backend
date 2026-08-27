/**
 * Buildspace API module: src/openapi.ts
 * Generates the maintained API inventory that the separately deployed Next.js frontend integrates against.
 */

import { writeFile } from "node:fs/promises";

/**
 * The API repositories are deliberately separate. This maintained OpenAPI inventory
 * is the wire contract the Next.js repository consumes; route code remains typed
 * internally with Zod. Add every new route here in the same pull request.
 */
type Route = { method: string; path: string; summary: string; tags: string[]; auth?: boolean };
const routes: Route[] = [
  { method: "get", path: "/health/live", summary: "Process liveness", tags: ["Health"] },
  { method: "get", path: "/health/ready", summary: "PostgreSQL and Redis readiness", tags: ["Health"] },
  { method: "get", path: "/health/database", summary: "Database readiness", tags: ["Health"] },
  { method: "post", path: "/api/v1/auth/sign-up", summary: "Create a password account", tags: ["Auth"] },
  { method: "post", path: "/api/v1/auth/sign-in", summary: "Sign in or receive an MFA challenge", tags: ["Auth"] },
  { method: "post", path: "/api/v1/auth/mfa/verify", summary: "Complete MFA sign-in", tags: ["Auth"] },
  { method: "get", path: "/api/v1/auth/me", summary: "Current account", tags: ["Auth"], auth: true },
  { method: "post", path: "/api/v1/auth/sign-out", summary: "Revoke browser session", tags: ["Auth"], auth: true },
  { method: "patch", path: "/api/v1/auth/profile", summary: "Update profile", tags: ["Auth"], auth: true },
  { method: "post", path: "/api/v1/auth/mfa/enroll", summary: "Start TOTP enrollment", tags: ["Auth"], auth: true },
  { method: "post", path: "/api/v1/auth/mfa/confirm", summary: "Confirm TOTP factor", tags: ["Auth"], auth: true },
  { method: "get", path: "/api/v1/discover/announcements", summary: "Active dashboard announcements", tags: ["Discovery"] },
  { method: "get", path: "/api/v1/discover/ideas", summary: "Trending public Ideas", tags: ["Discovery"] },
  { method: "get", path: "/api/v1/discover/spaces", summary: "Public active Spaces", tags: ["Discovery"] },
  { method: "get", path: "/api/v1/discover/following", summary: "Followed Spaces", tags: ["Discovery"], auth: true },
  { method: "get", path: "/api/v1/search", summary: "Search public Ideas and Spaces", tags: ["Discovery"] },
  { method: "get", path: "/api/v1/people", summary: "People directory", tags: ["People"] },
  { method: "get", path: "/api/v1/people/{handle}", summary: "Public profile", tags: ["People"] },
  { method: "post", path: "/api/v1/me/blocks/{userId}", summary: "Block a user", tags: ["Safety"], auth: true },
  { method: "delete", path: "/api/v1/me/blocks/{userId}", summary: "Unblock a user", tags: ["Safety"], auth: true },
  { method: "post", path: "/api/v1/reports", summary: "Report public content", tags: ["Safety"], auth: true },
  { method: "get", path: "/api/v1/ideas/{ideaId}", summary: "Idea detail and visible comments", tags: ["Ideas"] },
  { method: "post", path: "/api/v1/ideas", summary: "Create an Idea", tags: ["Ideas"], auth: true },
  ...["bookmark", "interest"].flatMap((action) => [
    { method: "post", path: `/api/v1/ideas/{ideaId}/${action}`, summary: `Add ${action}`, tags: ["Ideas"], auth: true },
    { method: "delete", path: `/api/v1/ideas/{ideaId}/${action}`, summary: `Remove ${action}`, tags: ["Ideas"], auth: true },
  ]),
  { method: "post", path: "/api/v1/ideas/{ideaId}/offers", summary: "Offer to help", tags: ["Ideas"], auth: true },
  { method: "get", path: "/api/v1/ideas/{ideaId}/offers", summary: "Creator-only offers", tags: ["Ideas"], auth: true },
  { method: "post", path: "/api/v1/ideas/{ideaId}/comments", summary: "Comment on an Idea", tags: ["Ideas"], auth: true },
  { method: "post", path: "/api/v1/ideas/{ideaId}/comments/{commentId}/hide", summary: "Hide a comment", tags: ["Ideas"], auth: true },
  { method: "post", path: "/api/v1/ideas/{ideaId}/promote", summary: "Create a Space from an Idea", tags: ["Ideas", "Spaces"], auth: true },
  { method: "post", path: "/api/v1/spaces", summary: "Create a Space", tags: ["Spaces"], auth: true },
  { method: "get", path: "/api/v1/spaces/{slug}", summary: "Space and team", tags: ["Spaces"], auth: true },
  { method: "get", path: "/api/v1/spaces/{slug}/overview", summary: "Compact workspace overview", tags: ["Spaces"], auth: true },
  { method: "patch", path: "/api/v1/spaces/{slug}/settings", summary: "Update Space settings", tags: ["Spaces"], auth: true },
  ...["follow"].flatMap((action) => [{ method: "post", path: `/api/v1/spaces/{slug}/${action}`, summary: "Follow public Space", tags: ["Spaces"], auth: true }, { method: "delete", path: `/api/v1/spaces/{slug}/${action}`, summary: "Unfollow public Space", tags: ["Spaces"], auth: true }]),
  { method: "post", path: "/api/v1/spaces/{slug}/invites", summary: "Create invite", tags: ["Spaces"], auth: true },
  { method: "post", path: "/api/v1/spaces/{slug}/join-requests", summary: "Request to join", tags: ["Spaces"], auth: true },
  { method: "patch", path: "/api/v1/spaces/{slug}/join-requests/{requestId}", summary: "Review join request", tags: ["Spaces"], auth: true },
  { method: "post", path: "/api/v1/spaces/{slug}/bans/{userId}", summary: "Ban member", tags: ["Spaces"], auth: true },
  ...["planning-notes", "roadmap-items", "tasks"].flatMap((resource) => [{ method: "get", path: `/api/v1/spaces/{slug}/${resource}`, summary: `List ${resource}`, tags: ["Workspace"], auth: true }, { method: "post", path: `/api/v1/spaces/{slug}/${resource}`, summary: `Create ${resource}`, tags: ["Workspace"], auth: true }]),
  { method: "post", path: "/api/v1/spaces/{slug}/planning-notes/{noteId}/promote", summary: "Promote note to task", tags: ["Workspace"], auth: true },
  { method: "get", path: "/api/v1/tasks/{taskId}", summary: "Task detail", tags: ["Workspace"], auth: true },
  { method: "patch", path: "/api/v1/tasks/{taskId}", summary: "Update task or board state", tags: ["Workspace"], auth: true },
  { method: "post", path: "/api/v1/tasks/{taskId}/comments", summary: "Comment on task", tags: ["Workspace"], auth: true },
  { method: "get", path: "/api/v1/spaces/{slug}/activity", summary: "Space activity feed", tags: ["Workspace"], auth: true },
  { method: "get", path: "/api/v1/spaces/{slug}/chat", summary: "Space chat history", tags: ["Chat"], auth: true },
  { method: "post", path: "/api/v1/spaces/{slug}/chat/messages", summary: "Send Space chat message", tags: ["Chat"], auth: true },
  { method: "post", path: "/api/v1/dm/requests", summary: "Send direct-message request", tags: ["Chat"], auth: true },
  { method: "get", path: "/api/v1/dm/requests", summary: "Message requests", tags: ["Chat"], auth: true },
  { method: "patch", path: "/api/v1/dm/requests/{requestId}", summary: "Accept or decline message request", tags: ["Chat"], auth: true },
  { method: "get", path: "/api/v1/dm/conversations", summary: "Direct conversations", tags: ["Chat"], auth: true },
  { method: "get", path: "/api/v1/conversations/{conversationId}/messages", summary: "Direct message history", tags: ["Chat"], auth: true },
  { method: "post", path: "/api/v1/conversations/{conversationId}/messages", summary: "Send direct message", tags: ["Chat"], auth: true },
  { method: "post", path: "/api/v1/messages/{messageId}/read", summary: "Mark message read", tags: ["Chat"], auth: true },
  { method: "get", path: "/api/v1/notifications", summary: "Notifications", tags: ["Notifications"], auth: true },
  { method: "post", path: "/api/v1/notifications/{notificationId}/read", summary: "Mark notification read", tags: ["Notifications"], auth: true },
  { method: "post", path: "/api/v1/notifications/read-all", summary: "Mark all notifications read", tags: ["Notifications"], auth: true },
  ...["calls", "ai/settings", "ai/runs", "integrations", "design-links"].flatMap((resource) => [{ method: "get", path: `/api/v1/spaces/{slug}/${resource}`, summary: `Read ${resource}`, tags: ["Realtime and AI"], auth: true }, { method: resource === "ai/settings" ? "put" : "post", path: `/api/v1/spaces/{slug}/${resource}`, summary: `Write ${resource}`, tags: ["Realtime and AI"], auth: true }]),
  { method: "post", path: "/api/v1/calls/{callId}/join", summary: "Issue LiveKit join token", tags: ["Calls"], auth: true },
  { method: "post", path: "/api/v1/calls/{callId}/end", summary: "End call", tags: ["Calls"], auth: true },
  { method: "get", path: "/api/v1/ai/runs/{runId}", summary: "AI run and citations", tags: ["AI"], auth: true },
  { method: "post", path: "/api/v1/spaces/{slug}/files/upload-url", summary: "Issue signed upload URL", tags: ["Files"], auth: true },
  { method: "get", path: "/api/v1/files/{fileId}/download-url", summary: "Issue signed download URL", tags: ["Files"], auth: true },
  { method: "post", path: "/api/v1/integrations/github/webhook", summary: "GitHub signed webhook receiver", tags: ["Integrations"] },
  { method: "get", path: "/api/v1/realtime", summary: "Authenticated WebSocket upgrade", tags: ["Realtime"], auth: true },
];

const paths: Record<string, Record<string, unknown>> = {};
for (const route of routes) {
  const path = paths[route.path] ?? (paths[route.path] = {});
  path[route.method] = {
    summary: route.summary,
    tags: route.tags,
    ...(route.auth ? { security: [{ sessionCookie: [] }] } : {}),
    responses: { "200": { description: "Successful response" }, "201": { description: "Created" }, "400": { description: "Validation error" }, "401": { description: "Unauthenticated" }, "403": { description: "Forbidden" }, "404": { description: "Not found" }, "503": { description: "Dependency not configured or unavailable" } },
  };
}
const document = { openapi: "3.1.0", info: { title: "Buildspace API", version: "0.1.0", description: "Separate standalone backend contract. Full request schemas live alongside Hono routes in src/modules." }, servers: [{ url: "http://localhost:4000" }], tags: Array.from(new Set(routes.flatMap((route) => route.tags))).map((name) => ({ name })), paths, components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "buildspace_session" } } } };
await writeFile("openapi.json", JSON.stringify(document, null, 2));
