/**
 * Buildspace API module: src/modules/auth/contracts.ts
 * Validates account, session, profile, and multi-factor authentication request payloads.
 */

import { z } from "zod";

// Passwords must be at least 12 characters long.
export const passwordSchema = z.string().min(12).max(256);

// Emails are trimmed and lowercased before being stored.
export const emailSchema = z
  .string()
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());

// Accepts the public details a new account is created with.
export const signUpInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(120),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
});

// Accepts an email/password pair when signing in.
export const signInInput = z.object({ email: emailSchema, password: z.string().min(1).max(256) });

// A six-digit TOTP code, ignoring any whitespace the user may type.
export const mfaCodeInput = z.object({
  code: z.preprocess(
    (value) => (typeof value === "string" ? value.replace(/\s/g, "") : value),
    z.string().regex(/^\d{6}$/),
  ),
});

// Same code plus the short-lived ticket issued during an MFA sign-in.
export const mfaVerifyInput = mfaCodeInput.extend({ ticket: z.string().min(1) });

// Fields a user may update on their own profile.
export const profileInput = z.object({
  displayName: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(500).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

// Request a password-reset ticket for an email address.
export const forgotPasswordInput = z.object({ email: emailSchema });

// Consume a reset ticket with a new password.
export const resetPasswordInput = z.object({
  ticket: z.string().min(1),
  password: passwordSchema,
});
