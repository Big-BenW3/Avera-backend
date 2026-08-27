/**
 * Buildspace API module: src/index.ts
 * Starts the HTTP and WebSocket server and gracefully closes PostgreSQL and Redis connections.
 */

import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createRedis } from "./realtime/events.js";
import { RealtimeGateway } from "./realtime/gateway.js";

const config = loadConfig();
const database = createDatabase(config);
const redisPair = createRedis(config);
await Promise.all([redisPair.client.connect(), redisPair.subscriber.connect()]);
const realtime = new RealtimeGateway(redisPair.subscriber);
const app = createApp({ config, database, redis: redisPair.client, realtime, requestId: "server" });
const websocket = new WebSocketServer({ noServer: true });
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0", websocket: { server: websocket } });
console.log(`Buildspace API listening on ${config.API_ORIGIN}`);
async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close();
  await Promise.all([database.pool.end(), redisPair.client.quit(), redisPair.subscriber.quit()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
