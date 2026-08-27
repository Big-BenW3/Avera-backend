/**
 * Buildspace API module: src/modules/auth/service.ts
 * Contains the account and session business logic kept separate from transport-specific routes.
 */

import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { TOTP, Secret } from "otpauth";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { authIdentities, mfaFactors, sessions, users } from "../../db/schema.js";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto.js";

const encoder = new TextEncoder();

type SessionUser = { id: string; email: string; handle: string; displayName: string };

export class AuthService {
  constructor(private readonly database: Database, private readonly config: AppConfig) {}

  async register(input: { email: string; password: string; handle: string; displayName: string }): Promise<SessionUser> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [user] = await this.database.db.insert(users).values({
      email: input.email,
      passwordHash,
      handle: input.handle,
      displayName: input.displayName,
    }).returning({ id: users.id, email: users.email, handle: users.handle, displayName: users.displayName });
    if (!user) throw new Error("User registration did not return a user.");
    return user;
  }

  async validatePassword(email: string, password: string): Promise<SessionUser | null> {
    const record = await this.database.db.select({
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
    }).from(users).where(eq(users.email, email)).limit(1);
    const user = record[0];
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) return null;
    return { id: user.id, email: user.email, handle: user.handle, displayName: user.displayName };
  }

  async issueSession(user: SessionUser, metadata: { ip?: string; userAgent?: string }): Promise<string> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.database.db.insert(sessions).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
      ipHash: metadata.ip ? sha256(metadata.ip) : null,
      userAgent: metadata.userAgent ?? null,
    });
    return token;
  }

  async revokeSession(token: string): Promise<void> {
    await this.database.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  }

  async getConfirmedFactor(userId: string) {
    const rows = await this.database.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.confirmedAt))).limit(1);
    // A confirmed factor has a non-null timestamp; use a second direct query to preserve clarity.
    const confirmed = await this.database.db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId)).limit(1);
    return confirmed.find((factor) => factor.confirmedAt !== null) ?? rows[0] ?? null;
  }

  async beginMfaEnrollment(user: SessionUser): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = new Secret({ size: 20 }).base32;
    const totp = new TOTP({ issuer: "Buildspace", label: user.email, algorithm: "SHA1", digits: 6, period: 30, secret });
    const encrypted = encryptSecret(secret, this.config.AUTH_JWT_SECRET);
    await this.database.db.delete(mfaFactors).where(eq(mfaFactors.userId, user.id));
    await this.database.db.insert(mfaFactors).values({ userId: user.id, secretCiphertext: encrypted, recoveryCodeHashes: [] });
    return { secret, otpauthUrl: totp.toString() };
  }

  async confirmMfa(userId: string, code: string): Promise<boolean> {
    const rows = await this.database.db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId)).limit(1);
    const factor = rows[0];
    if (!factor) return false;
    const secret = decryptSecret(factor.secretCiphertext, this.config.AUTH_JWT_SECRET);
    const valid = new TOTP({ secret, digits: 6, period: 30 }).validate({ token: code, window: 1 }) !== null;
    if (valid) await this.database.db.update(mfaFactors).set({ confirmedAt: new Date() }).where(eq(mfaFactors.id, factor.id));
    return valid;
  }

  async needsMfa(userId: string): Promise<boolean> {
    const factors = await this.database.db.select({ confirmedAt: mfaFactors.confirmedAt }).from(mfaFactors).where(eq(mfaFactors.userId, userId)).limit(1);
    return factors[0]?.confirmedAt !== null && factors[0]?.confirmedAt !== undefined;
  }

  async createMfaTicket(user: SessionUser): Promise<string> {
    return new SignJWT({ kind: "mfa" }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("10m").sign(encoder.encode(this.config.AUTH_JWT_SECRET));
  }

  async validateMfaTicket(ticket: string): Promise<string | null> {
    try {
      const result = await jwtVerify(ticket, encoder.encode(this.config.AUTH_JWT_SECRET));
      return result.payload.kind === "mfa" && result.payload.sub ? result.payload.sub : null;
    } catch {
      return null;
    }
  }

  async userForId(userId: string): Promise<SessionUser | null> {
    const rows = await this.database.db.select({ id: users.id, email: users.email, handle: users.handle, displayName: users.displayName })
      .from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  }

  async updateProfile(userId: string, input: { displayName: string; bio?: string | null; skills?: string[] }): Promise<SessionUser> {
    const [user] = await this.database.db.update(users).set({
      displayName: input.displayName,
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.skills !== undefined ? { skills: input.skills } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ id: users.id, email: users.email, handle: users.handle, displayName: users.displayName });
    if (!user) throw new Error("User not found.");
    return user;
  }

  // OAuth identities are stored separately from passwords. Provider callbacks are added only after real provider values exist.
  async attachIdentity(userId: string, provider: string, providerAccountId: string): Promise<void> {
    await this.database.db.insert(authIdentities).values({ userId, provider, providerAccountId });
  }
}
