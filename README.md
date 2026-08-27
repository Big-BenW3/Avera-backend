# Avera API

This is a **standalone Node.js 22 and Hono backend** for Avera. It contains no Manus code, credentials, OAuth session, database connection, or hosted-service dependency. It is intended to be kept in a separate repository from the Next.js frontend.

The API is a modular monolith: one HTTP and WebSocket process, one background-worker process, PostgreSQL for durable data, Redis for realtime fan-out and queue work, and server-side adapters for calls, AI, storage, and integrations. This is deliberately sized for an initial product of roughly 50 active users while retaining a credible path to scale.

## What is implemented

| Area | Included backend capability |
|---|---|
| Identity | Self-managed Argon2id passwords, opaque hashed sessions, secure cookies, TOTP MFA enrollment/confirmation, profile editing, block records, OAuth identity table. |
| Discovery | Announcements, public Ideas, search, categories, trending-interest counts, bookmarks, public Spaces, following. |
| Idea lifecycle | Creation, comments, creator moderation, interest, offers, and promotion into a Space. |
| Spaces | Creation, private/public visibility, membership roles, join requests, invite tokens, bans, follows, compact overview, settings. |
| Workspaces | Planning notes, roadmap items, tasks, task comments, activity events and outbox records. |
| Collaboration | Durable Space chat, direct-message requests, direct conversations, message receipts, notifications, Redis event fan-out. |
| Calls and AI | LiveKit room token boundary, NVIDIA-compatible AI provider boundary, Project Memory privacy setting that excludes chats/DMs, queueable AI runs. |
| Operations | Liveness, readiness, database check, typed runtime config, OpenAPI output, worker process, and tests. |

## Local setup

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Create a local `.env` file using your Neon Node.js connection string and Upstash ioredis URL, as described in [`docs/runtime-configuration.md`](docs/runtime-configuration.md). Docker is not required.
4. Generate and apply the database migration: `npm run db:generate` then `npm run db:migrate`.
5. Start the API: `npm run dev`.
6. Start the background worker in a second terminal: `npm run worker`.

The default API address is `http://localhost:4000`. Operational checks are available at `/health/live`, `/health/ready`, and `/health/database`. The OpenAPI document is available at `/openapi.json` when the server is running.

## Frontend integration

The Next.js frontend should call `/api/v1` through a generated client from the OpenAPI document. Use secure, same-site session cookies in production and set the frontend origin to the real Next.js domain. Do not place database URLs, LiveKit API secrets, NVIDIA keys, storage credentials, or OAuth client secrets in Next.js browser variables.

The detailed screen-to-route mapping is in [`docs/ui-route-map.md`](docs/ui-route-map.md). It is the checklist for replacing each current local UI interaction with a durable backend operation.

## Runtime configuration

All values are supplied by you; the repository intentionally has no real defaults for credentials. See [`docs/runtime-configuration.md`](docs/runtime-configuration.md). The required initial values are the API/frontend addresses, PostgreSQL URL, Redis URL, and a strong `AUTH_JWT_SECRET`. Configure LiveKit, NVIDIA, object storage, GitHub, Figma, and Google only when activating those capabilities.

## Deployment shape

Run two processes from this repository: `npm start` for the API and `npm run worker` for asynchronous events. They can share PostgreSQL and Redis. Use a managed PostgreSQL database, managed Redis, managed LiveKit, and object storage in production. At higher load, scale API instances horizontally; Redis distributes WebSocket events, and the worker can scale independently. Keep all auth and provider secrets in the server host’s secret manager.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the HTTP/WebSocket API in watch mode. |
| `npm run worker` | Run retryable outbox/AI work. |
| `npm run check` | Type-check without producing output. |
| `npm test` | Run unit tests. |
| `npm run build` | Compile the Node.js backend. |
| `npm run db:generate` | Generate an SQL migration from the Drizzle schema. |
| `npm run db:migrate` | Apply generated migrations. |
| `npm run openapi` | Write the OpenAPI contract to `openapi.json`. |
