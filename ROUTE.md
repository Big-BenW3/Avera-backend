# Avera Backend — API Route Catalogue

> Base: `http://localhost:4000` · Prefix: `/api/v1` (health/docs at root) · Auth: `Cookie: avera_session=<opaque>` or `Authorization: Bearer <token>` · `x-request-id` echoed · CORS `WEB_ORIGIN` allowlist
> Composed in `src/app.ts:32` via `createApp({config, database, redis, realtime})` `src/app.ts:55-59`. Docs: dynamic `GET /openapi.json` `src/app.ts:75` (`app.doc` from Zod), legacy `GET /openapi.manual.json` `src/app.ts:82`, Swagger `GET /docs` `src/app.ts:97`.

**Policy (2026-09-06):** Only `GET /api/v1/discover/announcements` + `GET /health/*` + `GET /docs|/openapi.json` are public. Every other route requires `requireAuth` (`src/middleware/auth.ts:48` → `401 UNAUTHENTICATED`). This was changed from the prior public reads on `discover/ideas`, `discover/spaces`, `search`, `ideas/:id`, `people` (`src/modules/discovery/routes.ts:24,41,65`, `src/modules/ideas/routes.ts:32`, `src/modules/users/routes.ts:15` now guarded).

## Auth — Two Factors (opt-in)

1. **Password session (mandatory):** `POST /auth/sign-up|sign-in` → `argon2id` `src/modules/auth/service.ts:23` → `issueSession()` `randomToken→sha256` stored `sessions.tokenHash` `src/db/schema.ts:67` + `Set-Cookie httpOnly Lax Max-Age 168h` `src/modules/auth/routes.ts:28`, `AUTH_JWT_SECRET` `src/config/env.ts:22`. `optionalAuth` resolves cookie/bearer against `sessions JOIN users WHERE expiresAt>now AND revokedAt IS NULL` `src/middleware/auth.ts:34`.
2. **TOTP MFA (opt-in):** `POST /auth/mfa/enroll` `src/modules/auth/routes.ts:124` (`requireAuth`) → `Secret 20b otpauth SHA1 6/30s` encrypted `AES-256-GCM` `src/lib/crypto.ts:24` → returns `{secret, otpauthUrl}` QR. `POST /auth/mfa/confirm` validates `window:1` `src/modules/auth/service.ts:85` sets `confirmedAt`. On login `needsMfa()` checks `confirmedAt` `src/modules/auth/service.ts:90` → returns `mfaTicket` `jose HS256 10m JWT` `src/modules/auth/service.ts:95` → `POST /auth/mfa/verify` `src/modules/auth/routes.ts:95` verifies ticket+code then issues session. No email codes, no OAuth.

## Health & Docs

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/health/live` | none | Liveness no DB/Redis `src/modules/health/routes.ts:10` | Probes |
| GET | `/health/database` | none | `select 1` readiness | Probes |
| GET | `/health/ready` | none | DB+Redis `pool.query + redis.ping` | Probes |
| GET | `/openapi.json` | none | **Dynamic Zod spec** `src/app.ts:75` `app.doc` — now includes `POST /auth/sign-up` requestBody `{email,password,handle,displayName}` so Swagger Try-it works (fix for your reported sign-up params missing) | Swagger |
| GET | `/openapi.manual.json` | none | Manual inventory `openapi.json` `src/openapi.ts` (legacy) | Codegen |
| GET | `/docs` | none | Swagger UI `src/app.ts:97` `swaggerUI({url:"/openapi.json"})` | Dev |

## Auth `src/modules/auth/routes.ts`

| Method | Path | Auth | Purpose | UI Screen |
|---|---|---|---|---|
| POST | `/api/v1/auth/sign-up` | none | Create `{email,password≥12,handle,displayName}` → `201` `Set-Cookie` or `409 ACCOUNT_CONFLICT` | SignUp |
| POST | `/api/v1/auth/sign-in` | none | Validate password → `200 {user,requiresMfa,mfaTicket}` or `401 INVALID_CREDENTIALS`; if MFA not needed sets cookie | SignIn → maybe MfaChallenge |
| POST | `/api/v1/auth/mfa/verify` | none | `{ticket,code 6-digit}` → ticket `jwtVerify` + TOTP → issues session | MfaChallenge |
| GET | `/api/v1/auth/me` | requireAuth | Return session user `src/modules/auth/routes.ts:110` | AppShell hydration guard |
| PATCH | `/api/v1/auth/profile` | requireAuth | `{displayName,bio,skills}` `src/modules/auth/service.ts:114` | Settings |
| POST | `/api/v1/auth/mfa/enroll` | requireAuth | Generate secret+otpauthUrl `201` | Security → Show QR |
| POST | `/api/v1/auth/mfa/confirm` | requireAuth | Verify initial 6-digit code enables MFA | Security → Confirm |
| POST | `/api/v1/auth/sign-out` | optionalAuth | Revoke `revokedAt` + `deleteCookie` `204` | Logout |
| POST | `/api/v1/auth/password/forgot` | none (rate-limited) | `{email}` → always `200 {sent:true}` (+`resetTicket` until email is wired) | ForgotPassword step 1 |
| POST | `/api/v1/auth/password/reset` | none (rate-limited) | `{ticket 30m, password≥12}` → `200 {user}`, revokes all sessions | ForgotPassword step 2 |

## Discovery `src/modules/discovery/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/discover/announcements` | **none** | Active `startsAt≤now<(endsAt=null\|>now)` `priority DESC` limit 10 | Dashboard banner |
| GET | `/api/v1/discover/ideas?category=` | **requireAuth** (was optionalAuth) | Public ideas join `ideaInterests` count `groupBy` `30` trending | DiscoverIdeas grid |
| GET | `/api/v1/discover/spaces?topic=&type=` | **requireAuth** | Public non-archived spaces `memberCount active` `30` | DiscoverSpaces grid |
| GET | `/api/v1/discover/following` | requireAuth | `spaceFollows JOIN spaces` ordered `followedAt DESC` | MyFollowing |
| GET | `/api/v1/search?q=` | **requireAuth** | `q≥2` `ILIKE` ideas title/body + spaces name/summary `10+10` | Global search typeahead |

## Ideas `src/modules/ideas/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/ideas/:ideaId` | **requireAuth** | Idea `isPublic` + visible comments `hiddenAt IS NULL` | IdeaDetail |
| POST | `/api/v1/ideas` | requireAuth | `{title 4-180, body 20-6000, category, lookingFor}` `201` | CreateIdeaModal |
| POST | `/api/v1/ideas/:id/bookmark` | requireAuth | `onConflictDoNothing` `204` | Bookmark toggle |
| DELETE | `/api/v1/ideas/:id/bookmark` | requireAuth | Delete `204` | Bookmark toggle |
| POST | `/api/v1/ideas/:id/interest` | requireAuth | `204` | Interested |
| DELETE | `/api/v1/ideas/:id/interest` | requireAuth | `204` | Uninterested |
| POST | `/api/v1/ideas/:id/offers` | requireAuth | `{offer 5-1000,availability}` `onConflictDoUpdate` `201` | Offer drawer |
| GET | `/api/v1/ideas/:id/offers` | requireAuth+owner | Creator-only list | Owner offers panel |
| POST | `/api/v1/ideas/:id/comments` | requireAuth | `{body 1-4000}` `201` | Thread |
| POST | `/api/v1/ideas/:id/comments/:cid/hide` | requireAuth+owner | Sets `hiddenAt` `204` else `403` | Owner moderation |
| POST | `/api/v1/ideas/:id/promote` | requireAuth+owner | Creates Space slug `name-id.slice(0,6)` + `lifecycle=promoted` `201` | Promote to Space CTA |

## Users `src/modules/users/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/people?q=` | **requireAuth** | `ILIKE handle/displayName` `50` | People directory |
| GET | `/api/v1/people/:handle` | **requireAuth** | Profile by handle `404` if missing | Public profile |
| POST | `/api/v1/me/blocks/:userId` | requireAuth | Block `400` if self `204` | Block action |
| DELETE | `/api/v1/me/blocks/:userId` | requireAuth | Unblock `204` | Unblock |

## Spaces `src/modules/spaces/routes.ts` — auth boundary `resolveSpaceAccess` `src/modules/spaces/access.ts:22`, `canAccess` checks owner OR `active`+permission (`*` for Owner `src/modules/spaces/routes.ts:50`)

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| POST | `/api/v1/spaces` | requireAuth | `{name,summary,category,type,visibility,recruiting,productStage,maxMembers}` slug `base-random(5)` txn Owner role+membership + `space.created` activity `201` | CreateSpace |
| GET | `/api/v1/spaces/:slug` | requireAuth | Private forbidden `403` if no access + members active | Space layout |
| GET | `/api/v1/spaces/:slug/overview` | requireAuth `space:view` | `taskStats total/done` + 6 `activityEvents` | Overview |
| PATCH | `/api/v1/spaces/:slug/settings` | requireAuth `space:manage` | Update `{summary,visibility,recruiting,externalUrl,category}` | Settings |
| POST | `/api/v1/spaces/:slug/follow` | requireAuth | Public only `404` else `204` | Follow |
| DELETE | `/api/v1/spaces/:slug/follow` | requireAuth | `204` | Unfollow |
| POST | `/api/v1/spaces/:slug/invites` | requireAuth `members:invite` | `{email,roleId}` `sha256 token` 7d expiry returns `{invite,acceptanceToken}` shown-once `201` | Invite modal |
| POST | `/api/v1/spaces/:slug/join-requests` | requireAuth | Public+recruiting only else `404` `201` | Request to join |
| PATCH | `/api/v1/spaces/:slug/join-requests/:rid` | requireAuth `members:manage` | `accepted/declined` + optional role txn membership `onConflictDoUpdate` | Review panel |
| POST | `/api/v1/spaces/:slug/bans/:userId` | requireAuth `members:manage` | Insert `spaceBans` + `removed` `204` | Ban |

## Planning `src/modules/planning/routes.ts` (`planning:edit`)

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/planning-notes` | requireAuth | `createdAt DESC` | Sticky board |
| POST | `/api/v1/spaces/:slug/planning-notes` | requireAuth | `{title 2-180, body 1-4000, color yellow/blue/red/green}` + activity | Add note |
| POST | `/api/v1/spaces/:slug/planning-notes/:nid/promote` | requireAuth | Promote to `Product` task `201` | Promote to task |
| GET | `/api/v1/spaces/:slug/roadmap-items` | requireAuth | `horizon,position` | Roadmap lanes |
| POST | `/api/v1/spaces/:slug/roadmap-items` | requireAuth | `{horizon now/next/later, title, description, position}` + activity `201` | Add item |

## Tasks `src/modules/tasks/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/tasks` | requireAuth `tasks:view` | `status,pos` | Kanban columns |
| POST | `/api/v1/spaces/:slug/tasks` | requireAuth `tasks:edit` | `{title,description,area,priority,assignee,roadmapItemId,dueAt}` + activity `201` | Create task |
| GET | `/api/v1/tasks/:taskId` | requireAuth `tasks:view` | Task + `taskComments` | Drawer |
| PATCH | `/api/v1/tasks/:taskId` | requireAuth `tasks:edit` | `{status, title, position...}` | Drag update |
| POST | `/api/v1/tasks/:taskId/comments` | requireAuth | `{body 1-4000}` + `task.comment_created` | Comment |

## Activity `src/modules/activity/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/activity` | requireAuth `activity:view` | 100 durable `activityEvents` `DESC` | Feed |

## Chat `src/modules/chat/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/chat` | requireAuth `chat:view` | `conversationId + items 100 reverse` auto-creates `space` conversation | Space chat |
| POST | `/api/v1/spaces/:slug/chat/messages` | requireAuth `chat:send` | `{body 1-8000, replyTo}` `201` | Send box |
| POST | `/api/v1/dm/requests` | requireAuth | `{recipientUserId, body 1-2000}` bidirectional block check `201` `403` if self/blocked | DM request |
| GET | `/api/v1/dm/requests` | requireAuth | Incoming pending where `recipient=current` | Inbox |
| PATCH | `/api/v1/dm/requests/:rid` | requireAuth | `accepted/declined` on accept txn `direct` conversation+2 members+initial message | Review |
| GET | `/api/v1/dm/conversations` | requireAuth | Direct where active member | DM list |
| GET | `/api/v1/conversations/:cid/messages` | requireAuth member | `100 non-deleted DESC reverse` | Thread |
| POST | `/api/v1/conversations/:cid/messages` | requireAuth member | `201` | Send DM |
| POST | `/api/v1/messages/:mid/read` | requireAuth member | Upsert `messageReceipts` `204` `404` if not member | Read receipt |

## Notifications `src/modules/notifications/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/notifications?unread=` | requireAuth | `100 DESC` optionally `readAt IS NULL` | Bell |
| POST | `/api/v1/notifications/:nid/read` | requireAuth | `readAt=now` `204` | Mark one |
| POST | `/api/v1/notifications/read-all` | requireAuth | Bulk `readAt=now` `204` | Mark all |

## Calls `src/modules/calls/routes.ts` — `livekit-server-sdk` `src/providers/livekit.ts:14`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/calls` | requireAuth `calls:view` | `createdAt` | Calls list |
| POST | `/api/v1/spaces/:slug/calls` | requireAuth `calls:start` | `{title 2-180, taskId, startsAt}` room `space-<id>-<opaque>` `scheduled|live` `201` | Schedule |
| POST | `/api/v1/calls/:cid/join` | requireAuth `calls:join` | `createLiveKitToken ttl 1h {roomJoin, canPublish, canSubscribe}` + `callParticipants` `scheduled→live` `503` if not configured | Join |
| POST | `/api/v1/calls/:cid/end` | requireAuth owner | Only `startedBy` else `403` → `ended` `204` | End |

## AI Project Memory `src/modules/ai/routes.ts` — chat excluded `chatExcluded:true` `src/db/schema.ts:406`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/ai/settings` | requireAuth `ai:view` | Or default `{enabledSources:[roadmap,tasks,activity,design,build], chatExcluded:true}` | AI settings view |
| PUT | `/api/v1/spaces/:slug/ai/settings` | requireAuth `ai:manage` | Upsert `enabledSources min1` `chatExcluded literal true` | Settings edit |
| POST | `/api/v1/spaces/:slug/ai/runs` | requireAuth `ai:run` | `{kind planning_interview/proposal/summary/task_breakdown/memory_question, prompt 1-12000, sourceIds 0-30}` → `aiRuns queued` `202` `503` if `NvidiaAiProvider` not configured `src/providers/nvidia.ts:16` | Prompt modal |
| GET | `/api/v1/spaces/:slug/ai/runs` | requireAuth `ai:view` | 50 `DESC` | History |
| GET | `/api/v1/ai/runs/:runId` | requireAuth | `run + citations` `404` | Detail |

> **No worker.** Runs are recorded as `queued` but nothing executes them in this
> deployment — there is no background process. A run stays `queued` indefinitely
> until an execution path exists.

## Files `src/modules/files/routes.ts` S3 presigned

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| POST | `/api/v1/spaces/:slug/files/upload-url` | requireAuth `files:write` | Key `spaces/<id>/<opaque>-filename` creates `files+fileLinks` returns `{file, uploadUrl}` `503` if bucket missing | Upload |
| GET | `/api/v1/files/:fid/download-url` | requireAuth owner | Owner-only `file.owner=userId` else `403` returns `{downloadUrl}` `503` if missing | Download |

## Integrations `src/modules/integrations/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| GET | `/api/v1/spaces/:slug/integrations` | requireAuth `integrations:view` | Strips `secretCiphertext` | Connections |
| GET | `/api/v1/spaces/:slug/design-links` | requireAuth `design:view` | List | Figma links |
| POST | `/api/v1/spaces/:slug/design-links` | requireAuth `design:edit` | `{externalFileId 1-255, url, title 1-180}` `201` | Link Figma |
| POST | `/api/v1/integrations/github/webhook` | requireAuth* | `x-hub-signature-256` `202 {accepted:true}` else `401` | GitHub |

## Safety `src/modules/safety/routes.ts`

| Method | Path | Auth | Purpose | UI |
|---|---|---|---|---|
| POST | `/api/v1/reports` | requireAuth | `{entityType idea/space/profile/comment, entityId UUID, reason spam/harassment/impersonation/other, context 0-3000}` `201` | Report |

## Realtime `src/app.ts:60` `GET /api/v1/realtime` WS upgrade `optionalAuth` → throws if no `auth` (effectively auth-required) `src/app.ts:62`, `RealtimeGateway` `src/realtime/gateway.ts:19` Redis `buildspace:<channel>` fan-out. Channels `space:<id>`, `conversation:<id>`. Events: `presence.changed, conversation.message_created, conversation.typing, notification.created, space.activity, call.changed, ai.delta, ai.completed` `src/realtime/events.ts:11`. `healthRoutes` remain unauth for probes.
