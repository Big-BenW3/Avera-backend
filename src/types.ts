/**
 * Buildspace API module: src/types.ts
 * Centralises the Hono context variables shared by routes, middleware, realtime code, and tests.
 */

import type { AppConfig } from "./config/env.js";
import type { Database } from "./db/client.js";
import type { Redis } from "ioredis";
import type { RealtimeGateway } from "./realtime/gateway.js";

export type AuthenticatedUser = {
  userId: string;
  sessionId: string;
  email: string;
  handle: string;
  displayName: string;
};

export type AppVariables = {
  config: AppConfig;
  database: Database;
  redis: Redis;
  realtime: RealtimeGateway;
  requestId: string;
  auth?: AuthenticatedUser;
};

export type AppEnv = { Variables: AppVariables };
