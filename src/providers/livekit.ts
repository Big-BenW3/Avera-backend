/**
 * Buildspace API module: src/providers/livekit.ts
 * Encapsulates server-side LiveKit configuration and token creation so provider secrets never reach browsers.
 */

import { AccessToken } from "livekit-server-sdk";
import type { AppConfig } from "../config/env.js";

export function liveKitConfigured(config: AppConfig): boolean {
  return Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
}

/** Server-only LiveKit token factory. The frontend receives a short-lived room token, never API credentials. */
export async function createLiveKitToken(config: AppConfig, input: { room: string; userId: string; displayName: string }): Promise<string> {
  if (!liveKitConfigured(config)) throw new Error("LiveKit has not been configured.");
  const token = new AccessToken(config.LIVEKIT_API_KEY!, config.LIVEKIT_API_SECRET!, { identity: input.userId, name: input.displayName, ttl: "1h" });
  token.addGrant({ roomJoin: true, room: input.room, canPublish: true, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}
