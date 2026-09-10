/**
 * Avera API module: src/lib/http.ts
 * Shared HTTP helpers: error envelopes, safe JSON parsing, UUID params.
 */
import { z } from "zod";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";

type Ctx = Context<AppEnv>;

export function apiError(
  context: Ctx,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
) {
  return context.json(
    { error: { code, message, requestId: context.get("requestId") } },
    status as 400,
  );
}

export function validationError(context: Ctx, message = "Request is invalid.") {
  return apiError(context, "VALIDATION_ERROR", message, 400);
}

export function forbidden(context: Ctx, message = "Access is required.") {
  return apiError(context, "FORBIDDEN", message, 403);
}

export function notFound(context: Ctx, message = "Not found.") {
  return apiError(context, "NOT_FOUND", message, 404);
}

/** Parse JSON body safely: malformed JSON becomes 400, not 500. */
export async function safeJson<T>(context: Ctx): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = (await context.req.json()) as T;
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

const uuid = z.string().uuid();

/** Validate a path param is a UUID; returns the value or null (caller sends 400/404). */
export function uuidParam(context: Ctx, name: string): string | null {
  const raw = context.req.param(name) ?? "";
  const parsed = uuid.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
