/**
 * Avera API module: src/index.ts
 * Starts the HTTP and WebSocket server and gracefully closes PostgreSQL and Redis connections.
 */

import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createRedis } from "./realtime/events.js";
import { RealtimeGateway } from "./realtime/gateway.js";

// Load configuration from environment variables.
const config = loadConfig();
// Create the PostgreSQL pool and Drizzle query builder.
const database = createDatabase(config);

// Redis needs two connections: one for commands, one for Pub/Sub.
const redisPair = createRedis(config);

// Bring both Redis connections online.
await Promise.all([redisPair.client.connect(), redisPair.subscriber.connect()]);

// The gateway forwards Redis events to local WebSocket clients.
const realtime = new RealtimeGateway(redisPair.subscriber);

// Build the app with all shared dependencies injected.
const app = createApp({ config, database, redis: redisPair.client, realtime, requestId: "server" });

// WebSocket support is layered on top of the plain HTTP server.
const websocket = new WebSocketServer({ noServer: true });

// Start listening for incoming HTTP requests.
const server = serve({
  fetch: app.fetch,
  port: config.PORT,
  hostname: "0.0.0.0",
  websocket: { server: websocket },
});
console.log(`Avera API listening on ${config.API_ORIGIN}`);

// Gracefully close the server and connections when the process is told to stop.
async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close();
  await Promise.all([database.pool.end(), redisPair.client.quit(), redisPair.subscriber.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
