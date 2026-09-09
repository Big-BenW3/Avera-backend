/**
 * Buildspace API module: src/modules/health/routes.ts
 * Provides liveness, dependency readiness, and database readiness checks for operations tooling.
 */

import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

export function healthRoutes() {
  const app = new Hono<AppEnv>();

  // Liveness: always returns ok while the process is running.
  app.get("/health/live", (context) =>
    context.json({ status: "ok", service: "buildspace-api", now: new Date().toISOString() }),
  );

  // Database-only readiness check.
  app.get("/health/database", async (context) => {
    try {
      await context.get("database").pool.query("select 1 as database_ready");
      return context.json({ status: "ok", database: "ready" });
    } catch {
      return context.json({ status: "error", database: "unavailable" }, 503);
    }
  });
  // Full readiness: both PostgreSQL and Redis must answer.
  app.get("/health/ready", async (context) => {
    try {
      const { pool } = context.get("database");
      const redis = context.get("redis");
      await Promise.all([pool.query("select 1"), redis.ping()]);
      return context.json({ status: "ok", database: "ready", redis: "ready" });
    } catch {
      return context.json(
        { status: "error", message: "A required dependency is unavailable." },
        503,
      );
    }
  });
  return app;
}
