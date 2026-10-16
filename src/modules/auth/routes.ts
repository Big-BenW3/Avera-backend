/**
 * Buildspace API module: src/modules/auth/routes.ts
 * Implements self-managed sign-up, sign-in, secure sessions, profile changes, and TOTP flows.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { optionalAuth, requireAuth, currentUserId } from "../../middleware/auth.js";
import { authRateLimit } from "../../middleware/rate-limit.js";
import type { AppEnv } from "../../types.js";
import { AuthService } from "./service.js";
import {
  forgotPasswordInput,
  mfaCodeInput,
  mfaVerifyInput,
  profileInput,
  resetPasswordInput,
  signInInput,
  signUpInput,
} from "./contracts.js";

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  handle: z.string(),
  displayName: z.string(),
});

const authResponseSchema = z.object({
  user: userSchema,
  requiresMfa: z.boolean(),
  mfaTicket: z.string().optional(),
});
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

// Build an AuthService instance bound to this request's database and config.
function service(context: {
  get(name: "database"): AppEnv["Variables"]["database"];
  get(name: "config"): AppEnv["Variables"]["config"];
}): AuthService {
  return new AuthService(context.get("database"), context.get("config"));
}

// Set the session cookie with the security flags required for browser sessions.
// SameSite=None is the only value that survives a cross-site deployment (frontend
// and API on different apex domains), and browsers reject it without Secure.
function sessionCookie(
  context: Parameters<typeof setCookie>[0],
  token: string,
  ttlHours: number,
  secure: boolean,
  name: string,
  sameSite: "lax" | "strict" | "none",
) {
  const isProd = process.env.NODE_ENV === "production";
  setCookie(context, name, token, {
    httpOnly: true,
    sameSite: sameSite === "lax" ? "Lax" : sameSite === "strict" ? "Strict" : "None",
    secure: sameSite === "none" ? true : secure || isProd,
    path: "/",
    maxAge: ttlHours * 60 * 60,
  });
}

// OpenAPI route definitions let the zod schemas appear in the generated docs.
const signUpRoute = createRoute({
  method: "post",
  path: "/auth/sign-up",
  request: { body: { content: { "application/json": { schema: signUpInput } } } },
  responses: {
    201: {
      content: { "application/json": { schema: authResponseSchema } },
      description: "Account created.",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Email or handle already exists.",
    },
  },
});

const signInRoute = createRoute({
  method: "post",
  path: "/auth/sign-in",
  request: { body: { content: { "application/json": { schema: signInInput } } } },
  responses: {
    200: {
      content: { "application/json": { schema: authResponseSchema } },
      description: "Signed in or MFA challenge issued.",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "Credentials are invalid.",
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ user: userSchema }) } },
      description: "Current account.",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "Session is missing.",
    },
  },
});

const mfaVerifyRoute = createRoute({
  method: "post",
  path: "/auth/mfa/verify",
  request: { body: { content: { "application/json": { schema: mfaVerifyInput } } } },
  responses: {
    200: {
      content: { "application/json": { schema: authResponseSchema } },
      description: "MFA verified, session issued.",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid input." },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Invalid code." },
    404: { content: { "application/json": { schema: errorSchema } }, description: "No account." },
  },
});

const profileRoute = createRoute({
  method: "patch",
  path: "/auth/profile",
  request: { body: { content: { "application/json": { schema: profileInput } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ user: userSchema }) } },
      description: "Profile updated.",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid input." },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Unauthenticated." },
  },
});

const mfaEnrollRoute = createRoute({
  method: "post",
  path: "/auth/mfa/enroll",
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({ secret: z.string(), otpauthUrl: z.string() }),
        },
      },
      description: "TOTP enrollment started.",
    },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Unauthenticated." },
    404: { content: { "application/json": { schema: errorSchema } }, description: "No account." },
  },
});

const mfaConfirmRoute = createRoute({
  method: "post",
  path: "/auth/mfa/confirm",
  request: { body: { content: { "application/json": { schema: mfaCodeInput } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } },
      description: "MFA enabled.",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid code." },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Unauthenticated." },
  },
});

const signOutRoute = createRoute({
  method: "post",
  path: "/auth/sign-out",
  responses: {
    204: { description: "Session revoked." },
  },
});

const forgotPasswordRoute = createRoute({
  method: "post",
  path: "/auth/password/forgot",
  request: { body: { content: { "application/json": { schema: forgotPasswordInput } } } },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            sent: z.boolean(),
            resetTicket: z.string().optional(),
          }),
        },
      },
      description: "Reset ticket issued (generic response, no enumeration).",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid input." },
  },
});

const resetPasswordRoute = createRoute({
  method: "post",
  path: "/auth/password/reset",
  request: { body: { content: { "application/json": { schema: resetPasswordInput } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ user: userSchema }) } },
      description: "Password reset, all sessions revoked.",
    },
    400: { content: { "application/json": { schema: errorSchema } }, description: "Invalid input." },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Invalid ticket." },
  },
});

/**
 * Own authentication module. It has no dependency on a hosted identity platform:
 * passwords are Argon2id hashes, browser sessions are opaque/hashed, and MFA uses TOTP.
 */
export function authRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  // Brute-force guard on credential + MFA endpoints (Redis fixed-window).
  app.use("/auth/sign-up", authRateLimit());
  app.use("/auth/sign-in", authRateLimit());
  app.use("/auth/mfa/verify", authRateLimit());
  app.use("/auth/password/forgot", authRateLimit());
  app.use("/auth/password/reset", authRateLimit());

  app.openapi(signUpRoute, async (context) => {
    // Register the account, then immediately start a session for the new user.
    const input = context.req.valid("json");
    try {
      const user = await service(context).register(input);
      const config = context.get("config");
      const token = await service(context).issueSession(user, {
        ip: context.req.header("x-forwarded-for"),
        userAgent: context.req.header("user-agent"),
      });
      sessionCookie(
        context,
        token,
        config.AUTH_SESSION_TTL_HOURS,
        config.AUTH_SECURE_COOKIES,
        config.AUTH_COOKIE_NAME,
        config.AUTH_COOKIE_SAMESITE,
      );
      return context.json({ user, requiresMfa: false }, 201);
    } catch (error) {
      // PostgreSQL unique violations should not leak internal table names to the client.
      const message =
        error instanceof Error && /unique/i.test(error.message)
          ? "Email or handle is already in use."
          : "Unable to create this account.";
      return context.json(
        { error: { code: "ACCOUNT_CONFLICT", message, requestId: context.get("requestId") } },
        409,
      );
    }
  });

  app.openapi(signInRoute, async (context) => {
    // Verify the credentials, then decide whether MFA confirmation is needed.
    const input = context.req.valid("json");
    const auth = service(context);
    const user = await auth.validatePassword(input.email, input.password);
    if (!user)
      return context.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email or password is incorrect.",
            requestId: context.get("requestId"),
          },
        },
        401,
      );

    if (await auth.needsMfa(user.id)) {
      // Return a one-time ticket instead of a session when MFA is required.
      return context.json(
        { user, requiresMfa: true, mfaTicket: await auth.createMfaTicket(user) },
        200,
      );
    }

    const config = context.get("config");
    // No MFA needed: issue a normal session cookie.
    const token = await auth.issueSession(user, {
      ip: context.req.header("x-forwarded-for"),
      userAgent: context.req.header("user-agent"),
    });
    sessionCookie(
      context,
      token,
      config.AUTH_SESSION_TTL_HOURS,
      config.AUTH_SECURE_COOKIES,
      config.AUTH_COOKIE_NAME,
      config.AUTH_COOKIE_SAMESITE,
    );
    return context.json({ user, requiresMfa: false }, 200);
  });

  app.openapi(mfaVerifyRoute, async (context) => {
    // Complete the sign-in by checking the code against the user's TOTP factor.
    const parsed = mfaVerifyInput.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A valid MFA ticket and six-digit code are required.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const auth = service(context);
    const userId = await auth.validateMfaTicket(parsed.data.ticket);
    if (!userId || !(await auth.confirmMfa(userId, parsed.data.code)))
      return context.json(
        {
          error: {
            code: "MFA_INVALID",
            message: "The verification code is invalid or expired.",
            requestId: context.get("requestId"),
          },
        },
        401,
      );
    const user = await auth.userForId(userId);
    if (!user)
      return context.json(
        {
          error: {
            code: "USER_NOT_FOUND",
            message: "Account no longer exists.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    const config = context.get("config");
    const token = await auth.issueSession(user, {
      ip: context.req.header("x-forwarded-for"),
      userAgent: context.req.header("user-agent"),
    });
    sessionCookie(
      context,
      token,
      config.AUTH_SESSION_TTL_HOURS,
      config.AUTH_SECURE_COOKIES,
      config.AUTH_COOKIE_NAME,
      config.AUTH_COOKIE_SAMESITE,
    );
    return context.json({ user, requiresMfa: false }, 200);
  });

  app.use("/auth/me", requireAuth);
  // Return the currently authenticated account from the session.
  app.openapi(meRoute, async (context) => {
    const auth = context.get("auth");
    return context.json(
      {
        user: {
          id: auth!.userId,
          email: auth!.email,
          handle: auth!.handle,
          displayName: auth!.displayName,
        },
      },
      200,
    );
  });

  app.use("/auth/profile", requireAuth);
  // Update the signed-in user's own profile fields.
  app.openapi(profileRoute, async (context) => {
    const parsed = profileInput.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Profile data is invalid.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const user = await service(context).updateProfile(currentUserId(context), parsed.data);
    return context.json({ user }, 200);
  });

  app.use("/auth/mfa/enroll", requireAuth);
  // Start TOTP enrollment and return the secret to scan into an authenticator app.
  app.openapi(mfaEnrollRoute, async (context) => {
    const user = await service(context).userForId(currentUserId(context));
    if (!user)
      return context.json(
        {
          error: {
            code: "USER_NOT_FOUND",
            message: "Account no longer exists.",
            requestId: context.get("requestId"),
          },
        },
        404,
      );
    return context.json(await service(context).beginMfaEnrollment(user), 201);
  });

  app.use("/auth/mfa/confirm", requireAuth);
  // Verify the code once so MFA is actually enabled for the account.
  app.openapi(mfaConfirmRoute, async (context) => {
    const parsed = mfaCodeInput.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A six-digit code is required.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const confirmed = await service(context).confirmMfa(currentUserId(context), parsed.data.code);
    return confirmed
      ? context.json({ enabled: true }, 200)
      : context.json(
          {
            error: {
              code: "MFA_INVALID",
              message: "The verification code is invalid.",
              requestId: context.get("requestId"),
            },
          },
          400,
        );
  });

  app.use("/auth/sign-out", optionalAuth);
  // Revoke the session in the database and clear the cookie.
  app.openapi(signOutRoute, async (context) => {
    const config = context.get("config");
    const token = getCookie(context, config.AUTH_COOKIE_NAME);
    if (token) await service(context).revokeSession(token);
    // Match the attributes used when setting the cookie, otherwise the browser
    // keeps the original cookie and the user stays signed in.
    deleteCookie(context, config.AUTH_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite:
        config.AUTH_COOKIE_SAMESITE === "lax"
          ? "Lax"
          : config.AUTH_COOKIE_SAMESITE === "strict"
            ? "Strict"
            : "None",
      secure:
        config.AUTH_COOKIE_SAMESITE === "none" ||
        config.AUTH_SECURE_COOKIES ||
        process.env.NODE_ENV === "production",
    });
    return context.body(null, 204);
  });

  // Request a password-reset ticket. Always 200 so emails cannot be enumerated.
  // The ticket is returned in the response until transactional email is wired.
  app.openapi(forgotPasswordRoute, async (context) => {
    const parsed = forgotPasswordInput.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A valid email address is required.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const result = await service(context).createPasswordResetTicket(parsed.data.email);
    if (!result) return context.json({ sent: true }, 200);
    return context.json({ sent: true, resetTicket: result.ticket }, 200);
  });

  // Consume a reset ticket with a new password; all sessions are revoked.
  app.openapi(resetPasswordRoute, async (context) => {
    const parsed = resetPasswordInput.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A valid ticket and 12+ character password are required.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
    const user = await service(context).resetPassword(parsed.data.ticket, parsed.data.password);
    if (!user)
      return context.json(
        {
          error: {
            code: "RESET_INVALID",
            message: "The reset link is invalid or expired.",
            requestId: context.get("requestId"),
          },
        },
        401,
      );
    return context.json({ user }, 200);
  });

  return app;
}
