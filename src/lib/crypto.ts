/**
 * Buildspace API module: src/lib/crypto.ts
 * Provides server-only password, token, encryption, and hashing helpers for self-managed security.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Hash a value with SHA-256 (used for session tokens and IPs so plain values never touch the DB).
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Generate a cryptographically random URL-safe token.
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Encrypt MFA secrets at rest. The encryption key is derived from the server-only
 * auth secret, so database backups alone cannot reveal a user’s TOTP secret.
 */
// Derive a fixed-size AES key from the server secret via SHA-256.
function encryptionKey(serverSecret: string): Buffer {
  return createHash("sha256").update(serverSecret).digest();
}

// Encrypt a secret with AES-256-GCM and pack iv + auth tag + ciphertext together.
export function encryptSecret(plaintext: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(serverSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

// Unpack and decrypt a value produced by encryptSecret.
export function decryptSecret(ciphertext: string, serverSecret: string): string {
  const payload = Buffer.from(ciphertext, "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(serverSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
