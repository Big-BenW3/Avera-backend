/**
 * Buildspace API module: src/tests/helpers.ts
 * Real DATABASE_URL integration harness — confirms conn, creates isolated app+session.
 */
import { createApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { RealtimeGateway } from "../realtime/gateway.js";
import { AuthService } from "../modules/auth/service.js";
import { randomToken } from "../lib/crypto.js";

export type TestContext = Awaited<ReturnType<typeof createTestApp>>;

// Shared testing harness: spins up a real app against the real database with a fake Redis.
export async function createTestApp() {
  const config = loadConfig();
  // Confirm the connection before every suite.
  const database = createDatabase(config);
  await database.pool.query("select 1 as test_conn_ok");

  // Fake Redis satisfies health/ready plus realtime without needing a network server.
  const fakeRedis: any = {
    ping: async () => "PONG",
    publish: async () => 1,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
    on: () => {},
    quit: async () => {},
    disconnect: () => {},
  };
  const realtime = new RealtimeGateway(fakeRedis as any);
  const app = createApp({ config, database, redis: fakeRedis, realtime } as any);
  return { app, config, database, fakeRedis, realtime };
}

// Create a brand-new user plus a valid session cookie for use in tests.
export async function createTestUser(
  context: TestContext,
  overrides: Partial<{ email: string; handle: string; displayName: string; password: string }> = {},
) {
  // Build unique credentials so parallel tests never collide.
  const suffix = randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const email = overrides.email ?? `test_${suffix}@example.com`;
  const handle = overrides.handle ?? `test-${suffix}`.slice(0, 20);
  const displayName = overrides.displayName ?? `Test ${suffix}`;
  const password = overrides.password ?? "TestPassword123!";
  const service = new AuthService(context.database as any, context.config);
  const user = await service.register({ email, handle, displayName, password });
  const token = await service.issueSession(user, { ip: "127.0.0.1", userAgent: "vitest" });

  // Return everything a test needs, including a ready-to-use Cookie header.
  return {
    user,
    token,
    email,
    handle,
    password,
    cookie: `${context.config.AUTH_COOKIE_NAME}=${token}`,
  };
}

// Turn a cookie string into the header object used by app.request().
export function authHeader(cookie: string) {
  return { Cookie: cookie };
}

// Best-effort cleanup: deleting the user cascades sessions/memberships via FKs.
export async function cleanupUser(context: TestContext, userId: string) {
  try {
    (await context.database.db.execute) as any;
  } catch {}
  try {
    await context.database.pool.query("delete from users where id = $1", [userId]);
  } catch {}
}
