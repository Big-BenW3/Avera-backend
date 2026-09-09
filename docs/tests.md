# Tests — Avera Backend

> **Real DATABASE_URL mode.** All integration tests hit Neon PostgreSQL (same `DATABASE_URL` as dev) + fake Redis. No mocks for business logic; `fakeRedis` only satisfies `health/ready` + `RealtimeGateway`. Config: `vitest.config.ts:13` (`testTimeout: 30000`, `hookTimeout: 30000`). Run `npm run test` or `npm run test:watch`.

## Stack

- Runner: `vitest@3` `vitest.config.ts:9` (`include: src/**/*.test.ts`, `environment: node`)
- App harness: `src/tests/helpers.ts:14` `createTestApp()` → `loadConfig()` `src/config/env.ts:50` + `createDatabase()` `src/db/client.ts:17` + `pool.query("select 1")` conn confirm (you requested) + `RealtimeGateway(fakeRedis)` `src/realtime/gateway.ts:12` → `createApp({config, database, redis, realtime})` `src/app.ts:32`
- Session: `AuthService.register + issueSession` `src/modules/auth/service.ts:22,47` → `randomToken→sha256` `src/lib/crypto.ts:8` → `Cookie: buildspace_session=<token>` (`AUTH_COOKIE_NAME` `src/config/env.ts:25`)
- Cleanup: `cleanupUser(pool DELETE FROM users WHERE id=$1)` cascades FKs (sessions, memberships, etc.)
- Isolation: random suffix `randomToken(4)` per user/space handle/email; unique DB rows per run. No shared state across `describe` except `ctx` pool reused.

## What is covered (~60 tests across 5 files)

| File | Tests | What it proves |
|---|---|---|
| `src/lib/crypto.test.ts:9` | 2 | `sha256` deterministic 64-hex, `encryptSecret/decryptSecret` roundtrip with `AUTH_JWT_SECRET` `src/lib/crypto.ts:20` |
| `src/modules/health/routes.test.ts:9` | 1 | `GET /health/live` no DB/Redis, `src/modules/health/routes.ts:12` |
| `src/modules/spaces/access.test.ts:9` | 2 | `canAccess` owner always true, `active`+permission vs `removed` `src/modules/spaces/access.ts:43` |
| `src/tests/routes.test.ts:5` | 38 | **Every route happy + 401 guard** — real DB + fake Redis, 401 guard + happy path |
| `src/tests/edge.test.ts:1` | ~17 | **Null / validation / edited / SQLi / auth-guard edge** — injection probes + malformed bodies for every module |

### `src/tests/routes.test.ts` breakdown (38)

1. **Health + docs (public) — 4** `src/tests/routes.test.ts:27`
   - `GET /health/live` 200, `/health/database` 200 (real pool `pool.query select 1`), `/health/ready` 200 (fake ping), `GET /discover/announcements` 200 public array `src/modules/discovery/routes.ts:16` (only banner+health stay public per `ROUTE.md` policy).

2. **Auth lifecycle — 2** `src/tests/routes.test.ts:49`
   - `POST /auth/sign-up` 201 + `set-cookie` contains `AUTH_COOKIE_NAME` → `GET /auth/me` 200 with cookie, 401 without → `POST /auth/sign-in` 200 → `POST /auth/sign-out` 204 → `GET /auth/me` 401 revocation `src/modules/auth/routes.ts:64,79,109,139`. Duplicate signup 409, bad password 401. User IDs pushed to `createdUserIds` for teardown.

3. **Protected 401 guard — 14** `src/tests/routes.test.ts:104` (loop)
   - Without cookie: `GET /discover/ideas`, `discover/spaces`, `search?q=ab`, `people`, `people/someone`, `ideas/:id`, `POST /ideas`, `discover/following`, `spaces/any/overview`, `notifications`, `spaces/any/chat`, `dm/requests`, `spaces/any/calls`, `spaces/any/ai/settings` → `401 UNAUTHENTICATED` `src/middleware/auth.ts:51`. Proves only `announcements+health` are public.

4. **Discovery + people + ideas (authed) — 5** `src/tests/routes.test.ts:129`
   - With cookie: `GET /discover/ideas` 200 array, `discover/spaces` 200, `search?q=ab` 200, `people` 200, `POST /ideas` 201 → `GET /ideas/:id` 200 → bookmark POST/DELETE 204, interest POST/DELETE 204, `POST /ideas/:id/comments` 201 → `POST .../hide` 204 (owner), `POST /offers` 201 → `GET /offers` 200, `POST /promote` 201 creates Space `slug = name-id.slice(0,6)` `src/modules/ideas/routes.ts:107` + `lifecycle=promoted`.

5. **Spaces → planning → tasks → activity → files/integrations/safety — 8** `src/tests/routes.test.ts:201`
   - `beforeAll` creates user + `POST /spaces` 201 (random slug `base-random(5)` `src/modules/spaces/routes.ts:46` txn Owner role `*` + membership). `GET /spaces/:slug` 200, `GET /overview` taskStats + 6 activity, `PATCH /settings` 200, `POST /planning-notes` 201 + `GET` 200 + promote `POST .../promote`, `POST /roadmap-items` 201 + list, `POST /spaces/:slug/tasks` 201 → `GET /spaces/:slug/tasks`, `GET /tasks/:id`, `PATCH /tasks/:id status=in_progress`, `POST /tasks/:id/comments` 201, `GET /activity` 100, `POST /spaces/:slug/follow` 404 (private), `POST /files/upload-url` 201|503|400 depending on `S3_BUCKET` (`src/providers/storage.ts`), `GET /spaces/:slug/integrations` 200 stripped, `GET /design-links` 200, `POST /reports` 201 `src/modules/safety/routes.ts:12`.

6. **Chat + DM + notifications — 4** `src/tests/routes.test.ts:296`
   - Two users A/B: `POST /dm/requests` A→B 201 → `GET /dm/requests` B inbox 200 → `PATCH /dm/requests/:id status=accepted` creates `direct` conversation + members+message `src/modules/chat/routes.ts:88` → `POST /conversations/:id/messages` 201 → `GET .../messages` 200 → `POST /messages/:id/read` 204 receipt → `GET /dm/conversations` 200. `Space chat requires membership`: `POST /spaces` by A → `GET /spaces/:slug/chat` B 403 vs A 200 → `POST .../chat/messages` 201. `GET /notifications` 200 + `POST /read-all` 204, `POST/DELETE /me/blocks/:id` 204 `src/modules/users/routes.ts:29`.

## Swagger fix (you reported: sign-up not taking parameters)

Root cause `src/app.ts:29,75` served static `openapi.json` (manual `src/openapi.ts:84` — summaries only, no `requestBody`). `OpenAPIHono`'s zod schemas (`src/modules/auth/routes.ts:37` `signUpInput`/`signInInput`) were never exposed. Fixed `src/app.ts:75` to `app.doc("/openapi.json", {openapi:"3.1.0", info:{title:"Avera API"}})` so `GET /openapi.json` is now dynamic with `requestBody` containing `email,password,handle,displayName` + `password min12` `src/modules/auth/contracts.ts:8`. `GET /docs` `src/app.ts:97` `swaggerUI({url:"/openapi.json"})` now shows Try-it payload for `POST /auth/sign-up` (test: `{"email":"testuser@gmail.com","password":"test123test123","handle":"testuser","displayName":"Test User"}`). Manual inventory kept at `GET /openapi.manual.json` `src/app.ts:82` for frontend codegen; run `npm run openapi` to rebuild it.

## SQL-injection protection

All queries are via `drizzle-orm` parameterized (`eq`, `ilike`, `sql` templates bind values — e.g., `ilike(users.handle, pattern)` `src/modules/users/routes.ts:19` where `pattern = %${query}%` is bound, not interpolated). No string-concatenated `pool.query("...${userInput}")` exists. Zod `contracts` reject malformed before DB. `src/tests/edge.test.ts` injects `' OR 1=1; --`, `'; DROP TABLE users; --`, `' UNION SELECT * FROM users --` into `email`, `handle`, `search?q`, `comment body`, `task status` etc. Each asserts `200` (stored literally or filtered) or `400/422`/`401`, then `select to_regclass('public.users')='users'` + `select 1` probes still succeed — proving no drop.

## How to run (you asked: real URL already set — not running now per your “dont run”)

```bash
# Uses same .env DATABASE_URL already confirmed `select 1` → DB_OK
npm run check             # tsc --noEmit — already green (no vitest run per your request)
# tonight:
npm run test              # vitest run (once, 30s per-test buffer for Neon cold start)
npm run test:watch        # watch
```

DB conn is verified twice: `createTestApp` `pool.query select 1 as test_conn_ok` `src/tests/helpers.ts:18` + suite `select 1 as ok` `src/tests/routes.test.ts:15`. If Neon is down you get `DB_FAIL` immediately. Code-checked only this pass (`npm run check` green) — no `vitest run` per your instruction.

## Edge file (`src/tests/edge.test.ts:1`) categories

- **Null:** `POST /auth/sign-up {}` → `400/422`, `{}→ POST /ideas` 400, `planning-notes {title:null}`, `conversation {body:null}` 400.
- **Validation/edited:** short password 11→400, invalid email 400, `PATCH /tasks/:id {status: "sqli"}`→400, `PATCH /spaces/:slug/settings {summary: sqli}` stored literally 200, wrong `mfa/verify` ticket 401.
- **SQLi:** payloads `SQLI`, `SQLI_DROP`, `SQLI_UNION` through auth, search `q`, `people?q`, `ideas/:id`, `comment body`, `category`, `dm body`, `message body` — each asserts parameterized path + `to_regclass` still `users`.
- **Auth guard:** `overview` without membership 403, `search` without cookie 401 already in `routes.test.ts:104`, plus `edge` re-proves.

Add via: `const u = await createTestUser(ctx); ids.push(u.user.id); await ctx.app.request("/api/v1/...", {headers:{Cookie:u.cookie}, body: JSON.stringify({sqli})})`


## Nightly solidification plan (your next session)

1. `npm run test` full pass — currently 8 time-outs at 5s; fixed to 30s in `vitest.config.ts:13`. If any 30s time-out remains, it is Neon pool latency → increase to 60s or add `max:5` pool wait.
2. Fix ordering: `spaces→planning→tasks` chain is serial — keep `beforeAll` slug alive per `describe`, don't parallelize.
3. Check `files/upload-url` expects `503` when `S3_BUCKET` empty — already allowed `201|503|400`.
4. After green, `npm run build` `tsc -p tsconfig.build.json` → `dist/`.
5. Then move to frontend: every fetch must send `credentials: "include"` (cookie) or `Authorization: Bearer <token>` `src/middleware/auth.ts:21`; unauth 401 → redirect `/sign-in` (see `ROUTE.md` policy).

## How to add a new route test

```ts
const u = await createTestUser(ctx); createdUserIds.push(u.user.id);
const res = await ctx.app.request("/api/v1/your/path", { method: "POST", headers: { "Content-Type": "application/json", Cookie: u.cookie }, body: JSON.stringify({...}) });
expect(res.status).toBe(201); // or 401 without Cookie
```

No `.env.test` fork — respects your request: real Neon, real secrets `AUTH_JWT_SECRET` `src/config/env.ts:22`.
