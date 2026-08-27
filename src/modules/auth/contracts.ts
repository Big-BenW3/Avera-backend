/**
 * Buildspace API module: src/modules/auth/contracts.ts
 * Validates account, session, profile, and multi-factor authentication request payloads.
 */

import { z } from "zod";

export const passwordSchema = z.string().min(12).max(256);
export const emailSchema = z.string().email().max(320).transform((value) => value.trim().toLowerCase());
export const signUpInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(120),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
});
export const signInInput = z.object({ email: emailSchema, password: z.string().min(1).max(256) });
export const mfaCodeInput = z.object({ code: z.preprocess((value) => typeof value === "string" ? value.replace(/\s/g, "") : value, z.string().regex(/^\d{6}$/)) });
export const mfaVerifyInput = mfaCodeInput.extend({ ticket: z.string().min(1) });
export const profileInput = z.object({
  displayName: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(500).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});
