/**
 * Buildspace API module: src/app.ts
 * Composes middleware, REST route modules, WebSocket upgrades, CORS, errors, and API-wide dependency injection.
 */

import { upgradeWebSocket } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { nanoid } from "nanoid";
import { authRoutes } from "./modules/auth/routes.js";
import { discoveryRoutes } from "./modules/discovery/routes.js";
import { ideaRoutes } from "./modules/ideas/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { safetyRoutes } from "./modules/safety/routes.js";
import { spaceRoutes } from "./modules/spaces/routes.js";
import { planningRoutes } from "./modules/planning/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { activityRoutes } from "./modules/activity/routes.js";
import { chatRoutes } from "./modules/chat/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { callRoutes } from "./modules/calls/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { integrationRoutes } from "./modules/integrations/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { optionalAuth } from "./middleware/auth.js";
import { realtimeEventSchema } from "./realtime/events.js";
import type { AppEnv } from "./types.js";
import { swaggerUI } from "@hono/swagger-ui";
import openApiDocument from "../openapi.json" with { type: "json" };


export function createApp(dependencies: AppEnv["Variables"]) {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("config", dependencies.config);
    context.set("database", dependencies.database);
    context.set("redis", dependencies.redis);
    context.set("realtime", dependencies.realtime);
    context.set("requestId", context.req.header("x-request-id") ?? nanoid());
    await next();
    context.header("x-request-id", context.get("requestId"));
  });

  app.use("/api/v1/*", async (context, next) => {
    if (context.req.path !== "/api/v1/realtime") {
      context.header("Access-Control-Allow-Origin", dependencies.config.WEB_ORIGIN);
      context.header("Access-Control-Allow-Credentials", "true");
      context.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
      context.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    }
    if (context.req.method === "OPTIONS") return context.body(null, 204);
    await next();
  });

  app.route("/", healthRoutes());
  const api = app.basePath("/api/v1");
  api.route("/", authRoutes()); api.route("/", discoveryRoutes()); api.route("/", ideaRoutes()); api.route("/", userRoutes()); api.route("/", safetyRoutes());
  api.route("/", spaceRoutes()); api.route("/", planningRoutes()); api.route("/", taskRoutes()); api.route("/", activityRoutes()); api.route("/", chatRoutes());
  api.route("/", notificationRoutes()); api.route("/", callRoutes()); api.route("/", aiRoutes()); api.route("/", fileRoutes()); api.route("/", integrationRoutes());
  api.get("/realtime", optionalAuth, upgradeWebSocket((context) => {
    const auth = context.get("auth");
    if (!auth) throw new Error("Authenticated WebSocket session required.");
    return {
      onOpen: (_event, socket) => socket.send(JSON.stringify({ type: "realtime.connected", requestId: context.get("requestId"), userId: auth.userId })),
      onMessage: async (event, socket) => {
        try {
          const inbound = realtimeEventSchema.parse(JSON.parse(String(event.data)));
          if (!inbound.channel.startsWith("space:") && !inbound.channel.startsWith("conversation:")) return;
          await dependencies.realtime.subscribe(inbound.channel, socket);
        } catch { socket.send(JSON.stringify({ type: "realtime.error", message: "Invalid realtime event." })); }
      },
      onClose: async (_event, socket) => { await dependencies.realtime.unsubscribeAll(socket); },
    };
  }));
  app.get("/openapi.json", (context) => context.json(openApiDocument));

  app.onError((error, context) => {
    console.error({ requestId: context.get("requestId"), error }, "Unhandled API error");
    return context.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", requestId: context.get("requestId") } }, 500);
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));
  
  app.notFound((context) => context.json({ error: { code: "NOT_FOUND", message: "Route not found.", requestId: context.get("requestId") } }, 404));
  return app;
}
