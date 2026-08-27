/**
 * Buildspace API module: src/realtime/gateway.ts
 * Forwards authorised Redis channels to local WebSocket clients and cleans up subscriptions safely.
 */

import type { Redis } from "ioredis";

/** A small broker that fans Redis Pub/Sub events to local WebSocket clients. */
export class RealtimeGateway {
  private readonly channels = new Map<string, Set<{ send(message: string): void }>>();

  constructor(private readonly subscriber: Redis) {
    this.subscriber.on("message", (redisChannel: string, raw: string) => {
      const channel = redisChannel.replace(/^buildspace:/, "");
      for (const socket of this.channels.get(channel) ?? []) socket.send(raw);
    });
  }

  async subscribe(channel: string, socket: { send(message: string): void }): Promise<void> {
    const listeners = this.channels.get(channel) ?? new Set();
    listeners.add(socket);
    this.channels.set(channel, listeners);
    if (listeners.size === 1) await this.subscriber.subscribe(`buildspace:${channel}`);
  }

  async unsubscribeAll(socket: { send(message: string): void }): Promise<void> {
    for (const [channel, listeners] of this.channels) {
      listeners.delete(socket);
      if (listeners.size === 0) {
        this.channels.delete(channel);
        await this.subscriber.unsubscribe(`buildspace:${channel}`);
      }
    }
  }
}
