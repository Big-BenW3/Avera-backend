# Existing Buildspace UI to API map

| Frontend flow | API routes and realtime events |
|---|---|
| Landing, sign-up, sign-in, MFA | `POST /api/v1/auth/sign-up`, `POST /auth/sign-in`, `POST /auth/mfa/verify`, `GET /auth/me`, `POST /auth/sign-out` |
| Discover dashboard, carousel, active Spaces | `GET /discover/announcements`, `/discover/ideas`, `/discover/spaces`, `/discover/following`, `/search` |
| Trending Idea hover/bookmark and Idea detail | `POST/DELETE /ideas/:ideaId/bookmark`, `GET /ideas/:ideaId`, `/interest`, `/offers`, `/comments`, `/promote` |
| People, profiles, blocks, safety | `GET /people`, `/people/:handle`, `POST/DELETE /me/blocks/:userId`, `POST /reports` |
| Create Space and Hackathon scheduling | `POST /spaces`, `POST /spaces/:slug/join-requests`, planned `/spaces/:slug/timebox` contract backed by `space_timeboxes` |
| Space overview, team, settings, invites | `GET /spaces/:slug`, `/overview`, `PATCH /settings`, `POST /invites`, join request review, bans, follows |
| Roadmap, planning notes, tasks, build activities | `GET/POST /spaces/:slug/roadmap-items`, planning notes/promote, `GET/POST /spaces/:slug/tasks`, task patch/comments, `GET /spaces/:slug/activity` |
| Collaborate, DMs, message requests, receipts | Space chat routes, `/dm/requests`, `/dm/conversations`, conversation message routes, `POST /messages/:messageId/read` |
| Calls and presence | `GET/POST /spaces/:slug/calls`, `POST /calls/:callId/join`, `POST /calls/:callId/end`, authenticated `/api/v1/realtime` WebSocket channels |
| Project Memory and AI planning | `GET/PUT /spaces/:slug/ai/settings`, `POST /spaces/:slug/ai/runs`, `GET /ai/runs/:runId` |
| Design, files, GitHub/Figma | design-link routes, signed file upload/download routes, integration status and signed GitHub webhook boundary |
| Notifications | `GET /notifications`, `POST /notifications/:notificationId/read`, `POST /notifications/read-all` |

Every write route should be connected by replacing the frontend’s local state mutation with an API call, optimistic cache update, and WebSocket invalidation or event handler. The API persists an activity event/outbox record before it broadcasts the related live event.
