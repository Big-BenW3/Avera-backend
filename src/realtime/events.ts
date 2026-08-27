/**
 * Buildspace API module: src/realtime/events.ts
 * Defines validated realtime event envelopes and the Redis Pub/Sub connection used for instance fan-out.
 */

import { Redis } from "ioredis";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";

export const realtimeEventSchema = z.object({
  id: z.string(),
  type: z.enum(["presence.changed", "conversation.message_created", "conversation.typing", "notification.created", "space.activity", "call.changed", "ai.delta", "ai.completed"]),
  channel: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

/**
 * Redis isolates WebSocket clients from API instances. At 50 users it is also the
 * cache, rate-limit, queue, and presence store; no in-memory room state is required.
 */
export function createRedis(config: Pick<AppConfig, "REDIS_URL">) {
  const client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const subscriber = client.duplicate({ lazyConnect: true });
  return { client, subscriber };
}

export async function publishEvent(redis: Redis, event: RealtimeEvent): Promise<void> {
  await redis.publish(`buildspace:${event.channel}`, JSON.stringify(event));
}
