/**
 * Buildspace API module: src/config/env.ts
 * Validates runtime settings supplied by the deployment environment; no secrets are hard-coded here.
 */

import { config as loadEnvironment } from "dotenv";
import { z } from "zod";

// Load local developer configuration when present. Production hosts inject values directly.
loadEnvironment();

const optionalUrl = z.string().url().optional().or(z.literal(""));

export const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_ORIGIN: z.string().url().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_JWT_SECRET: z.string().min(32),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_COOKIE_NAME: z.string().min(1).default("buildspace_session"),
  AUTH_SECURE_COOKIES: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: optionalUrl,
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  LIVEKIT_URL: optionalUrl,
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  NVIDIA_NIM_BASE_URL: optionalUrl,
  NVIDIA_NIM_API_KEY: z.string().optional(),
  NVIDIA_NIM_MODEL_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof environmentSchema>;

/**
 * Parse configuration once at process start. Keeping this function explicit makes
 * tests deterministic and ensures no secret is accidentally read in browser code.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(source);
}
