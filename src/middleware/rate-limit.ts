/**
 * Avera API module: src/middleware/rate-limit.ts
 * Redis fixed-window rate limiting (strict): per-IP + per-user buckets.
 * Degrades open when Redis is unavailable (fake Redis in tests).
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

export type RateLimitOptions = {
  /** Window in seconds. */
  windowSeconds: number;
  /** Max requests per window. */
  max: number;
  /** Key prefix to isolate buckets. */
  prefix: string;
  /** Also bucket by authenticated user id when present. */
  byUser?: boolean;
};

function clientIp(context: { req: { header(name: string): string | undefined } }): string {
  const forwarded = context.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64);
  return "unknown";
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const { windowSeconds, max, prefix, byUser = true } = options;
  return async (context, next) => {
    let redis: unknown;
    try {
      redis = context.get("redis");
    } catch {
      await next();
      return;
    }
    const r = redis as {
      incr?(key: string): Promise<number>;
      expire?(key: string, secs: number): Promise<unknown>;
      ttl?(key: string): Promise<number>;
    } | null;
    if (!r || typeof r.incr !== "function" || typeof r.expire !== "function") {
      await next();
      return;
    }
    const userId = (context.get("auth") as { userId?: string } | undefined)?.userId;
    const bucket = byUser && userId ? `u:${userId}` : `ip:${clientIp(context)}`;
    const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `ratelimit:${prefix}:${bucket}:${windowId}`;
    try {
      const count = await r.incr!(key);
      if (count === 1) await r.expire!(key, windowSeconds);
      if (count > max) {
        let retryAfter = windowSeconds;
        try {
          if (typeof r.ttl === "function") {
            const ttl = await r.ttl(key);
            if (typeof ttl === "number" && ttl > 0) retryAfter = ttl;
          }
        } catch {
          /* keep default */
        }
        context.header("Retry-After", String(retryAfter));
        return context.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests. Please slow down.",
              requestId: context.get("requestId"),
            },
          },
          429,
        );
      }
    } catch {
      // Redis failure must not take the API down.
    }
    await next();
  };
}

/** Presets: global + strict buckets for auth / AI / writes / webhook. */
export const globalRateLimit = () =>
  rateLimit({ prefix: "global", windowSeconds: 60, max: 300, byUser: false });

export const authRateLimit = () =>
  rateLimit({ prefix: "auth", windowSeconds: 60, max: 20, byUser: false });

export const aiRateLimit = () =>
  rateLimit({ prefix: "ai", windowSeconds: 60 * 60 * 24, max: 50 });

export const writeRateLimit = () =>
  rateLimit({ prefix: "write", windowSeconds: 60, max: 60 });

export const webhookRateLimit = () =>
  rateLimit({ prefix: "webhook", windowSeconds: 60, max: 60, byUser: false });
