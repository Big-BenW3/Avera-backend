/**
 * Avera API module: src/app.ts
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
import { readFile } from "node:fs/promises";

export function createApp(dependencies: AppEnv["Variables"]) {
  const app = new OpenAPIHono<AppEnv>();

  // Global middleware: inject shared dependencies and a request ID into every handler.
  app.use("*", async (context, next) => {
    context.set("config", dependencies.config);
    context.set("database", dependencies.database);
    context.set("redis", dependencies.redis);
    context.set("realtime", dependencies.realtime);

    // Reuse the caller's ID, or generate one so errors can be traced end to end.
    context.set("requestId", context.req.header("x-request-id") ?? nanoid());
    await next();

    // Echo the request ID back to the client in the response headers.
    context.header("x-request-id", context.get("requestId"));
  });

  // CORS middleware: let the web frontend call this API from its own origin.
  app.use("/api/v1/*", async (context, next) => {
    if (context.req.path !== "/api/v1/realtime") {
      context.header("Access-Control-Allow-Origin", dependencies.config.WEB_ORIGIN);
      context.header("Access-Control-Allow-Credentials", "true");
      context.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key",
      );
      context.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    }

    // Short-circuit browser preflight (OPTIONS) requests.
    if (context.req.method === "OPTIONS") return context.body(null, 204);
    await next();
  });

  // Health endpoints live at the root, outside the versioned API.
  app.route("/", healthRoutes());

  // Mount every feature as a sub-app under /api/v1.
  // The auth module uses Zod schemas so its spec is generated for OpenAPI.
  app.route("/api/v1", authRoutes());
  // Other modules are plain Hono mounts (their spec is kept in openapi.json).
  app.route("/api/v1", discoveryRoutes());
  app.route("/api/v1", ideaRoutes());
  app.route("/api/v1", userRoutes());
  app.route("/api/v1", safetyRoutes());
  app.route("/api/v1", spaceRoutes());
  app.route("/api/v1", planningRoutes());
  app.route("/api/v1", taskRoutes());
  app.route("/api/v1", activityRoutes());
  app.route("/api/v1", chatRoutes());
  app.route("/api/v1", notificationRoutes());
  app.route("/api/v1", callRoutes());
  app.route("/api/v1", aiRoutes());
  app.route("/api/v1", fileRoutes());
  app.route("/api/v1", integrationRoutes());
  // WebSocket endpoint: realtime updates for authenticated users.
  app.get(
    "/api/v1/realtime",
    optionalAuth,
    upgradeWebSocket((context) => {
      const auth = context.get("auth");
      if (!auth) throw new Error("Authenticated WebSocket session required.");
      return {
        // Announce a successful connection right away.
        onOpen: (_event, socket) =>
          socket.send(
            JSON.stringify({
              type: "realtime.connected",
              requestId: context.get("requestId"),
              userId: auth.userId,
            }),
          ),
        onMessage: async (event, socket) => {
          try {
            // Validate the incoming subscribe request against the shared schema.
            const inbound = realtimeEventSchema.parse(JSON.parse(String(event.data)));
            // Only space/conversation channels may be subscribed by clients.
            if (
              !inbound.channel.startsWith("space:") &&
              !inbound.channel.startsWith("conversation:")
            )
              return;
            await dependencies.realtime.subscribe(inbound.channel, socket);
          } catch {
            socket.send(
              JSON.stringify({ type: "realtime.error", message: "Invalid realtime event." }),
            );
          }
        },
        // Remove the socket from every channel when the client disconnects.
        onClose: async (_event, socket) => {
          await dependencies.realtime.unsubscribeAll(socket);
        },
      };
    }),
  );

  // Merge the zod-derived auth spec with the hand-written openapi.json inventory so
  // Swagger shows every operation without losing the detailed request bodies.
  // Serve the merged OpenAPI document.
  app.get("/openapi.json", async (context) => {
    try {
      // Read the hand-written spec from disk.
      const manualRaw = await readFile(new URL("../openapi.json", import.meta.url), "utf-8");
      const manual: any = JSON.parse(manualRaw);

      // Generate the zod-derived spec from the auth module at runtime.
      const dynamic: any = app.getOpenAPI31Document({
        openapi: "3.1.0",
        info: { title: "Avera API", version: "0.1.0" },
      });

      // Combine both sources, letting the dynamic spec win on paths/components.
      const merged: any = {
        ...manual,
        paths: { ...(manual.paths ?? {}), ...(dynamic.paths ?? {}) },
        components: {
          ...(manual.components ?? {}),
          ...(dynamic.components ?? {}),
          schemas: {
            ...(manual.components?.schemas ?? {}),
            ...(dynamic.components?.schemas ?? {}),
          },
        },
      };

      // Keep the hand-written servers/tags when the dynamic spec has none.
      if (!merged.servers?.length && manual.servers) merged.servers = manual.servers;
      if (!merged.tags?.length && manual.tags) merged.tags = manual.tags;
      return context.json(merged);
    } catch (error) {
      // If the manual file is missing, fall back to the generated spec only.
      const dynamic: any = app.getOpenAPI31Document({
        openapi: "3.1.0",
        info: {
          title: "Avera API",
          version: "0.1.0",
          description: "Standalone backend — Zod-validated routes.",
        },
        servers: [{ url: "http://localhost:4000" }],
      } as any);
      return context.json(dynamic);
    }
  });

  // Expose just the hand-written inventory for debugging or external tooling.
  app.get("/openapi.manual.json", async (context) => {
    try {
      const raw = await readFile(new URL("../openapi.json", import.meta.url), "utf-8");
      return context.json(JSON.parse(raw));
    } catch {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Manual spec not built. Run npm run openapi." } },
        404,
      );
    }
  });

  // Catch-all error handler: log the failure and return a clean JSON body.
  app.onError((error, context) => {
    console.error({ requestId: context.get("requestId"), error }, "Unhandled API error");
    return context.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          requestId: context.get("requestId"),
        },
      },
      500,
    );
  });

  // Interactive Swagger documentation powered by the merged OpenAPI document.
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  // Unknown routes return a consistent JSON 404 instead of an HTML page.
  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
          requestId: context.get("requestId"),
        },
      },
      404,
    ),
  );
  return app;
}
