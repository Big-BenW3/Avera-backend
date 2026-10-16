# Avera — Deployment Guide

Deploys two things: the **API** and the **frontend**. The API is
already live at `https://avera-backend.onrender.com`.

```
Frontend  Vercel    ──HTTPS──▶  API  Render Web Service  ──▶  Neon Postgres
                                                     └──▶  Upstash Redis
```

There is **no worker**. The backend is a single process started with `npm start`.

---

## 0. Fix the live CORS config before anything else ⚠️

Your live API currently answers **every** request with:

```
access-control-allow-origin: http://localhost:3000
```

That is the old pre-allowlist behaviour (before commit `15803ae`). Because a
browser only accepts the response if that header *matches* the calling origin,
**any deployed frontend is blocked** — no sign-in, no API calls, nothing.

The cause is the `WEB_ORIGIN` value in Render's environment. Do this:

1. Render dashboard → your web service → **Environment**.
2. Set `WEB_ORIGIN` to your real frontend origin(s), comma-separated, no trailing
   slash, exact scheme:

   ```
   https://avera.vercel.app,https://avera-frontend.vercel.app
   ```

3. Set these while you're there:

   | Variable | Value | Why |
   |---|---|---|
   | `NODE_ENV` | `production` | Enables HSTS, forces `Secure` cookies |
   | `AUTH_COOKIE_SAMESITE` | `none` | **Required.** See below |
   | `AUTH_SECURE_COOKIES` | `true` | `SameSite=None` is rejected without `Secure` |

4. **Redeploy.** Env changes only apply on a new deploy.

### Why `SameSite=None` is mandatory right now

`avera.vercel.app` and `avera-backend.onrender.com` are different apex domains, so
the browser considers requests between them **cross-site**. A `SameSite=Lax` cookie
is not attached to `fetch()` calls, so every authenticated request would 401.

`AUTH_COOKIE_SAMESITE=none` is the fix. **Both** sites must be HTTPS, which they are.

> Later, if you buy a domain and point `app.avera.com` + `api.avera.com` at them,
> set this back to `lax`. It is a one-value change with no code edit.

**Verify after redeploy:**

```bash
curl -s -o /dev/null -D - -H "Origin: https://avera.vercel.app" \
  https://avera-backend.onrender.com/api/v1/discover/announcements | grep -i allow-origin
# expect: access-control-allow-origin: https://avera.vercel.app
```

---

## 1. API service settings on Render

Single Web Service, native Node runtime. Node 22 is picked up automatically from
the `engines` field in `package.json`.

| Field | Value |
|---|---|
| Name | `avera-backend` |
| Repository | `Big-BenW3/Avera-backend` |
| Branch | `main` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Root Directory | *(blank)* |
| Health Check Path | `/health/live` |

`argon2` is the only native module in the tree, and it ships prebuilt binaries for
linux-x64-glibc, which is what Render runs. Nothing extra to install.

**There is no second service and no background worker.** If you created one while
exploring this, delete it.

### Environment variables

```
NODE_ENV=production
DATABASE_URL=          (Neon connection string)
REDIS_URL=             (Upstash ioredis URL)
AUTH_JWT_SECRET=       (openssl rand -base64 48)
API_ORIGIN=https://avera-backend.onrender.com
WEB_ORIGIN=https://avera.vercel.app
PORT=4000
LOG_LEVEL=info
AUTH_SESSION_TTL_HOURS=168
AUTH_REFRESH_TTL_DAYS=30
AUTH_COOKIE_NAME=avera_session
AUTH_SECURE_COOKIES=true
AUTH_COOKIE_SAMESITE=none
```

`DATABASE_URL`, `REDIS_URL`, and `AUTH_JWT_SECRET` are required -- the process
crashes on boot without any of them. Everything else has a default.

---

## 2. Frontend on Vercel

| Field | Value |
|---|---|
| Repository | `Big-BenW3/Avera-Frontend` |
| Framework preset | Next.js (auto-detected) |
| Root directory | *(leave blank — the repo IS the frontend)* |

Environment variable, **set before the first build**:

```
NEXT_PUBLIC_API_BASE_URL=https://avera-backend.onrender.com
```

> `NEXT_PUBLIC_*` values are **baked in at build time**. If it's missing, the app
> falls back to `http://localhost:4000` and every call fails in production.
> Changing it later requires a redeploy, not just a save.

Add the resulting Vercel domains to the API's `WEB_ORIGIN` (step 0), then redeploy
the API.

**Note:** `avera.vercel.app`, `avera-frontend.vercel.app`, and `avera-web.vercel.app`
all currently respond. Confirm which is your production project and add exactly
that one to `WEB_ORIGIN`.

---

## 3. Database migrations

Apply once, from a machine with the Neon URL:

```bash
cd Backend
npm ci
npm run migrate:deploy
```

Because `drizzle/meta/` was previously gitignored, older deploys could not
migrate. That's fixed — but if the Neon database is already at
`0000_numerous_ironclad`, this is a no-op and you can skip it.

Check state first:

```sql
select * from drizzle.__drizzle_migrations order by created_at desc limit 3;
```

---

## 4. End-to-end smoke test

Run these after the redeploy. Each step depends on the one before it.

```bash
API=https://avera-backend.onrender.com

# 1. Liveness + dependencies
curl -s $API/health/live     # {"status":"ok",...}
curl -s $API/health/ready    # database + redis both ready

# 2. CORS reflects the allowlisted origin
curl -s -o /dev/null -D - -H "Origin: https://avera.vercel.app" \
  $API/api/v1/discover/announcements | grep -i allow-origin

# 3. Sign up and capture the cookie
curl -s -c /tmp/avera.jar -X POST $API/api/v1/auth/sign-up \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","displayName":"You","handle":"you","password":"a-strong-password-123"}'

# 4. The cookie must work cross-site
curl -s -b /tmp/avera.jar $API/api/v1/auth/me    # expect your user, NOT 401
```

In the browser: sign up → land on `/discover` → create an idea → create a space →
open it. If you get bounced to `/login` immediately, the cookie isn't attaching —
re-check `AUTH_COOKIE_SAMESITE` and `WEB_ORIGIN`.

---

## 5. Operational notes

- **Free-tier API:** Render spins the free instance down after ~15 min idle and
  takes ~50s to wake. The first request in a demo may hang. Use a paid instance.
- **Redis is a hard boot dependency.** `src/index.ts` awaits `client.connect()`
  before serving; there's no retry, so if Upstash is unreachable the process dies
  and Render restarts it in a loop.
- **Health check:** use `/health/live`. `/health/ready` also pings Redis and will
  fail your deploy if Upstash hiccups.
- **Rate limiting trusts `x-forwarded-for`.** Fine on Render; don't front this with
  something that doesn't strip client-supplied values.
- **`/docs` is public.** Swagger UI is served unauthenticated at
  `/openapi.json` + `/docs`. Add a Render IP allowlist if that's a concern.

---

## 6. Not yet deployed

These env vars are empty in every environment, so the features below return 503 or
fail. None block the deploy:

| Feature | Missing |
|---|---|
| Calls | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| AI | `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_MODEL_ID` (no executor exists yet) |
| File uploads | `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| OAuth sign-in | `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` |
| GitHub webhooks | reuses `GITHUB_CLIENT_SECRET` as the HMAC key |

The frontend renders "Connect GitHub" in `/spaces/[slug]` — that button has no
backend behind it yet.
