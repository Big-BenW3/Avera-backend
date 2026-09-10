/**
 * Avera API module: src/middleware/security.ts
 * Security headers + JSON body-size guard.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/** Minimal helmet-equivalent headers for an API + Swagger UI host. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header("Cross-Origin-Opener-Policy", "same-origin");
  // Swagger UI needs inline scripts; keep CSP report-only style and permissive for /docs.
  if (!context.req.path.startsWith("/docs")) {
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  }
  if (process.env.NODE_ENV === "production") {
    context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};

/** Reject huge JSON payloads before zod parsing (memory-DoS guard). */
export function bodyLimit(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const length = context.req.header("content-length");
    if (length) {
      const n = Number(length);
      if (Number.isFinite(n) && n > maxBytes) {
        return context.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: "Request body is too large.",
              requestId: context.get("requestId"),
            },
          },
          413,
        );
      }
    }
    await next();
  };
}
