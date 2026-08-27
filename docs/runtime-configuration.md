# Runtime configuration

Supply configuration through your host's secret manager or a local `.env` file. This repository intentionally contains no credentials and no platform-specific configuration. Docker is not required for local development: use Neon for PostgreSQL and Upstash for Redis.

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | Yes | `development`, `test`, or `production` |
| `PORT` | Yes | HTTP port, for example `4000` |
| `API_ORIGIN` | Yes | Public API URL |
| `WEB_ORIGIN` | Yes | Next.js frontend URL for CORS |
| `DATABASE_URL` | Yes | Neon Node.js PostgreSQL connection string, including `sslmode=require` |
| `REDIS_URL` | Yes | Upstash **ioredis** TLS connection string, beginning with `rediss://` |
| `AUTH_JWT_SECRET` | Yes | Long random server-only session signing secret |
| `AUTH_SESSION_TTL_HOURS` | No | Defaults to `168` |
| `AUTH_REFRESH_TTL_DAYS` | No | Defaults to `30` |
| `AUTH_COOKIE_NAME` | No | Defaults to `buildspace_session` |
| `AUTH_SECURE_COOKIES` | No | Set to `true` behind HTTPS |
| `S3_*` | Later | Object storage configuration for attachments |
| `LIVEKIT_*` | Later | Server-only LiveKit keys for call-token generation |
| `NVIDIA_NIM_*` | Later | Server-only NVIDIA NIM endpoint, API key, and model ID |
| `GITHUB_*`, `GOOGLE_*` | Later | OAuth client configuration |

Generate `AUTH_JWT_SECRET` with a cryptographically secure source, such as `openssl rand -base64 48`.

## Neon and Upstash local development

Copy the **Node.js** connection string from Neon’s Connect panel into `DATABASE_URL`. Copy the **ioredis** TLS URL from the Upstash Redis Connect panel into `REDIS_URL`; do not use Upstash REST variables for this Node.js backend. A minimal local file is:

```env
NODE_ENV=development
PORT=4000
API_ORIGIN=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
REDIS_URL=rediss://:PASSWORD@HOST:PORT
AUTH_JWT_SECRET=REPLACE_WITH_A_LONG_RANDOM_VALUE
AUTH_SECURE_COOKIES=false
```

After saving this file, run `npm run db:migrate`, then run `npm run dev` and `npm run worker` in a second terminal. Keep the `.env` file uncommitted.
