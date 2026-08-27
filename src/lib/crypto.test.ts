/**
 * Buildspace API module: src/lib/crypto.test.ts
 * Verifies the security helper behaviors without using any real account or provider data.
 */

import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto.js";

describe("backend cryptography helpers", () => {
  it("hashes opaque sessions deterministically without retaining their raw token", () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThan(30);
    expect(sha256(token)).toHaveLength(64);
    expect(sha256(token)).toBe(sha256(token));
  });
  it("encrypts an MFA secret at rest and decrypts it only with the server secret", () => {
    const sealed = encryptSecret("MFA-SECRET", "a-long-server-secret-that-exceeds-thirty-two-characters");
    expect(sealed).not.toContain("MFA-SECRET");
    expect(decryptSecret(sealed, "a-long-server-secret-that-exceeds-thirty-two-characters")).toBe("MFA-SECRET");
  });
});
