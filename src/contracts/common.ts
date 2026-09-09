/**
 * Buildspace API module: src/contracts/common.ts
 * Defines shared validation and response shapes used consistently across API modules.
 */

import { z } from "zod";

// A standard UUID, used for most primary/foreign keys.
export const idSchema = z.string().uuid();

// Reusable pagination parameters for list endpoints.
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// The standard error envelope every endpoint returns on failure.
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
