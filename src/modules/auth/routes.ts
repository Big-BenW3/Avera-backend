/**
 * Buildspace API module: src/modules/auth/routes.ts
 * Implements self-managed sign-up, sign-in, secure sessions, profile changes, and TOTP flows.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { optionalAuth, requireAuth, currentUserId } from "../../middleware/auth.js";
import type { AppEnv } from "../../types.js";
import { AuthService } from "./service.js";
import { mfaCodeInput, mfaVerifyInput, profileInput, signInInput, signUpInput } from "./contracts.js";

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  handle: z.string(),
  displayName: z.string(),
});

const authResponseSchema = z.object({ user: userSchema, requiresMfa: z.boolean(), mfaTicket: z.string().optional() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) });

function service(context: { get(name: "database"): AppEnv["Variables"]["database"]; get(name: "config"): AppEnv["Variables"]["config"] }): AuthService {
  return new AuthService(context.get("database"), context.get("config"));
}

function sessionCookie(context: Parameters<typeof setCookie>[0], token: string, ttlHours: number, secure: boolean, name: string) {
  setCookie(context, name, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: ttlHours * 60 * 60,
  });
}

const signUpRoute = createRoute({
  method: "post",
  path: "/auth/sign-up",
  request: { body: { content: { "application/json": { schema: signUpInput } } } },
  responses: { 201: { content: { "application/json": { schema: authResponseSchema } }, description: "Account created." }, 409: { content: { "application/json": { schema: errorSchema } }, description: "Email or handle already exists." } },
});

const signInRoute = createRoute({
  method: "post",
  path: "/auth/sign-in",
  request: { body: { content: { "application/json": { schema: signInInput } } } },
  responses: { 200: { content: { "application/json": { schema: authResponseSchema } }, description: "Signed in or MFA challenge issued." }, 401: { content: { "application/json": { schema: errorSchema } }, description: "Credentials are invalid." } },
});

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  responses: { 200: { content: { "application/json": { schema: z.object({ user: userSchema }) } }, description: "Current account." }, 401: { content: { "application/json": { schema: errorSchema } }, description: "Session is missing." } },
});

/**
 * Own authentication module. It has no dependency on a hosted identity platform:
 * passwords are Argon2id hashes, browser sessions are opaque/hashed, and MFA uses TOTP.
 */
export function authRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(signUpRoute, async (context) => {
    const input = context.req.valid("json");
    try {
      const user = await service(context).register(input);
      const config = context.get("config");
      const token = await service(context).issueSession(user, { ip: context.req.header("x-forwarded-for"), userAgent: context.req.header("user-agent") });
      sessionCookie(context, token, config.AUTH_SESSION_TTL_HOURS, config.AUTH_SECURE_COOKIES, config.AUTH_COOKIE_NAME);
      return context.json({ user, requiresMfa: false }, 201);
    } catch (error) {
      // PostgreSQL unique violations should not leak internal table names to the client.
      const message = error instanceof Error && /unique/i.test(error.message) ? "Email or handle is already in use." : "Unable to create this account.";
      return context.json({ error: { code: "ACCOUNT_CONFLICT", message, requestId: context.get("requestId") } }, 409);
    }
  });

  app.openapi(signInRoute, async (context) => {
    const input = context.req.valid("json");
    const auth = service(context);
    const user = await auth.validatePassword(input.email, input.password);
    if (!user) return context.json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect.", requestId: context.get("requestId") } }, 401);

    if (await auth.needsMfa(user.id)) {
      return context.json({ user, requiresMfa: true, mfaTicket: await auth.createMfaTicket(user) }, 200);
    }

    const config = context.get("config");
    const token = await auth.issueSession(user, { ip: context.req.header("x-forwarded-for"), userAgent: context.req.header("user-agent") });
    sessionCookie(context, token, config.AUTH_SESSION_TTL_HOURS, config.AUTH_SECURE_COOKIES, config.AUTH_COOKIE_NAME);
    return context.json({ user, requiresMfa: false }, 200);
  });

  app.post("/auth/mfa/verify", async (context) => {
    const parsed = mfaVerifyInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "A valid MFA ticket and six-digit code are required.", requestId: context.get("requestId") } }, 400);
    const auth = service(context);
    const userId = await auth.validateMfaTicket(parsed.data.ticket);
    if (!userId || !(await auth.confirmMfa(userId, parsed.data.code))) return context.json({ error: { code: "MFA_INVALID", message: "The verification code is invalid or expired.", requestId: context.get("requestId") } }, 401);
    const user = await auth.userForId(userId);
    if (!user) return context.json({ error: { code: "USER_NOT_FOUND", message: "Account no longer exists.", requestId: context.get("requestId") } }, 404);
    const config = context.get("config");
    const token = await auth.issueSession(user, { ip: context.req.header("x-forwarded-for"), userAgent: context.req.header("user-agent") });
    sessionCookie(context, token, config.AUTH_SESSION_TTL_HOURS, config.AUTH_SECURE_COOKIES, config.AUTH_COOKIE_NAME);
    return context.json({ user, requiresMfa: false }, 200);
  });

  app.use("/auth/me", requireAuth);
  app.openapi(meRoute, async (context) => {
    const auth = context.get("auth");
    return context.json({ user: { id: auth!.userId, email: auth!.email, handle: auth!.handle, displayName: auth!.displayName } }, 200);
  });

  app.use("/auth/profile", requireAuth);
  app.patch("/auth/profile", async (context) => {
    const parsed = profileInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "Profile data is invalid.", requestId: context.get("requestId") } }, 400);
    const user = await service(context).updateProfile(currentUserId(context), parsed.data);
    return context.json({ user }, 200);
  });

  app.use("/auth/mfa/enroll", requireAuth);
  app.post("/auth/mfa/enroll", async (context) => {
    const user = await service(context).userForId(currentUserId(context));
    if (!user) return context.json({ error: { code: "USER_NOT_FOUND", message: "Account no longer exists.", requestId: context.get("requestId") } }, 404);
    return context.json(await service(context).beginMfaEnrollment(user), 201);
  });

  app.use("/auth/mfa/confirm", requireAuth);
  app.post("/auth/mfa/confirm", async (context) => {
    const parsed = mfaCodeInput.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: { code: "VALIDATION_ERROR", message: "A six-digit code is required.", requestId: context.get("requestId") } }, 400);
    const confirmed = await service(context).confirmMfa(currentUserId(context), parsed.data.code);
    return confirmed ? context.json({ enabled: true }, 200) : context.json({ error: { code: "MFA_INVALID", message: "The verification code is invalid.", requestId: context.get("requestId") } }, 400);
  });

  app.use("/auth/sign-out", optionalAuth);
  app.post("/auth/sign-out", async (context) => {
    const config = context.get("config");
    const token = getCookie(context, config.AUTH_COOKIE_NAME);
    if (token) await service(context).revokeSession(token);
    deleteCookie(context, config.AUTH_COOKIE_NAME, { path: "/" });
    return context.body(null, 204);
  });

  return app;
}
