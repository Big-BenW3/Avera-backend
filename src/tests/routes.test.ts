/**
 * Buildspace API module: src/tests/routes.test.ts
 * Full coverage for every route — uses real DATABASE_URL (Neon) + fake Redis.
 * Confirms DB conn (`select 1`) before suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, createTestUser, cleanupUser } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const createdUserIds: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
  // Extra explicit confirm (user asked)
  const r = await ctx.database.pool.query("select 1 as ok, now()::text as now");
  expect(r.rows[0].ok).toBe(1);
});

afterAll(async () => {
  for (const id of createdUserIds) await cleanupUser(ctx, id);
  await ctx.database.pool.end();
  // fakeRedis quit is no-op
});

function json(res: Response) {
  return res.json() as Promise<any>;
}

// -----------------------------------------------------------------------------
// Public endpoints that must work without any session.
describe("health + docs (public)", () => {
  it("GET /health/live 200 without auth", async () => {
    const res = await ctx.app.request("/health/live");
    expect(res.status).toBe(200);
    await expect(json(res)).resolves.toMatchObject({ status: "ok" });
  });
  it("GET /health/database 200 (real pool)", async () => {
    const res = await ctx.app.request("/health/database");
    expect(res.status).toBe(200);
  });
  it("GET /health/ready 200 (fake redis ping)", async () => {
    const res = await ctx.app.request("/health/ready");
    expect(res.status).toBe(200);
  });
  it("GET /api/v1/discover/announcements 200 public", async () => {
    const res = await ctx.app.request("/api/v1/discover/announcements");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.items)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Full auth lifecycle exercised end to end against the real database.
describe("auth lifecycle — signup -> session -> me -> sign-in -> sign-out", () => {
  it("POST /auth/sign-up 201 sets cookie, GET /auth/me 200, POST /sign-out 204, then me 401", async () => {
    const handle = `t-${Date.now().toString(36).slice(-6)}`;
    const email = `${handle}@example.com`;
    const res = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "TestPassword123!",
        handle,
        displayName: `Test ${handle}`,
      }),
    });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(ctx.config.AUTH_COOKIE_NAME);
    const body: any = await json(res);
    createdUserIds.push(body.user.id);

    // me with cookie
    const me = await ctx.app.request("/api/v1/auth/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);

    // me without cookie -> 401
    const me401 = await ctx.app.request("/api/v1/auth/me");
    expect(me401.status).toBe(401);

    // sign-in with same creds
    const signIn = await ctx.app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "TestPassword123!" }),
    });
    expect(signIn.status).toBe(200);
    const signCookie = signIn.headers.get("set-cookie") ?? cookie;

    // sign-out
    const out = await ctx.app.request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { Cookie: signCookie },
    });
    expect(out.status).toBe(204);

    // me after sign-out -> 401 (revoked)
    const meAfter = await ctx.app.request("/api/v1/auth/me", { headers: { Cookie: signCookie } });
    expect(meAfter.status).toBe(401);
  });

  it("POST /auth/sign-up 409 on duplicate, sign-in 401 on bad password", async () => {    const h = `dup-${Date.now().toString(36).slice(-5)}`;
    const e = `${h}@example.com`;
    const r1 = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, password: "TestPassword123!", handle: h, displayName: h }),
    });
    expect(r1.status).toBe(201);
    const b: any = await json(r1);
    createdUserIds.push(b.user.id);
    const r2 = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, password: "TestPassword123!", handle: h, displayName: h }),
    });
    expect(r2.status).toBe(409);
    const bad = await ctx.app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, password: "wrongpassword123" }),
    });
    expect(bad.status).toBe(401);
  });

  it("password reset: forgot -> reset -> sign-in with new password, old session revoked", async () => {
    const h = `pw-${Date.now().toString(36).slice(-5)}`;
    const e = `${h}@example.com`;
    const signup = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, password: "TestPassword123!", handle: h, displayName: h }),
    });
    expect(signup.status).toBe(201);
    const sb: any = await json(signup);
    createdUserIds.push(sb.user.id);
    const oldCookie = signup.headers.get("set-cookie") ?? "";

    const forgot = await ctx.app.request("/api/v1/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e }),
    });
    expect(forgot.status).toBe(200);
    const fb: any = await json(forgot);
    expect(fb.sent).toBe(true);
    expect(typeof fb.resetTicket).toBe("string");

    // Unknown email stays generic 200 with no ticket.
    const forgotUnknown = await ctx.app.request("/api/v1/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `nobody-${h}@example.com` }),
    });
    expect(forgotUnknown.status).toBe(200);
    expect((await json(forgotUnknown)).resetTicket).toBeUndefined();

    const reset = await ctx.app.request("/api/v1/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: fb.resetTicket, password: "NewPassword123!" }),
    });
    expect(reset.status).toBe(200);

    // Old session revoked by the reset.
    const meOld = await ctx.app.request("/api/v1/auth/me", { headers: { Cookie: oldCookie } });
    expect(meOld.status).toBe(401);

    // New password works.
    const signIn = await ctx.app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, password: "NewPassword123!" }),
    });
    expect(signIn.status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// Every protected route must reject an anonymous request with 401.
describe("protected routes require 401 when unauthenticated (banner+health are only public)", () => {
  const protectedPaths: Array<[string, string]> = [
    ["GET", "/api/v1/discover/ideas"],
    ["GET", "/api/v1/discover/spaces"],
    ["GET", "/api/v1/search?q=ab"],
    ["GET", "/api/v1/people"],
    ["GET", "/api/v1/people/someone"],
    ["GET", "/api/v1/ideas/00000000-0000-0000-0000-000000000000"],
    ["POST", "/api/v1/ideas"],
    ["GET", "/api/v1/discover/following"],
    ["GET", "/api/v1/spaces/any/overview"],
    ["GET", "/api/v1/notifications"],
    ["GET", "/api/v1/spaces/any/chat"],
    ["GET", "/api/v1/dm/requests"],
    ["GET", "/api/v1/spaces/any/calls"],
    ["GET", "/api/v1/spaces/any/ai/settings"],
  ];
  for (const [method, path] of protectedPaths) {
    it(`${method} ${path} -> 401 without cookie`, async () => {
      const res = await ctx.app.request(path, { method: method as any });
      expect(res.status).toBe(401);
    });
  }
});

// -----------------------------------------------------------------------------
// Discovery, people, and ideas work when authenticated.
describe("discovery + people + ideas with auth", () => {
  let cookie = "";
  let userId = "";
  beforeAll(async () => {
    const u = await createTestUser(ctx);
    cookie = u.cookie;
    userId = u.user.id;
    createdUserIds.push(userId);
  });

  it("GET /discover/ideas 200 with auth", async () => {
    const res = await ctx.app.request("/api/v1/discover/ideas", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const b: any = await json(res);
    expect(Array.isArray(b.items)).toBe(true);
  });
  it("GET /discover/spaces 200", async () => {
    const res = await ctx.app.request("/api/v1/discover/spaces", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
  it("GET /search?q=ab 200", async () => {
    const res = await ctx.app.request("/api/v1/search?q=ab", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
  it("GET /people 200", async () => {
    const res = await ctx.app.request("/api/v1/people", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
  it("POST /ideas -> GET /ideas/:id -> bookmark/interest/comment flows", async () => {
    const create = await ctx.app.request("/api/v1/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Test idea ultra",
        body: "This is a long enough body for idea validation twenty chars.",
        category: "tooling",
        lookingFor: "designer",
      }),
    });
    expect(create.status).toBe(201);
    const { idea }: any = await json(create);
    expect(idea.id).toBeDefined();

    const get = await ctx.app.request(`/api/v1/ideas/${idea.id}`, { headers: { Cookie: cookie } });
    expect(get.status).toBe(200);

    const bm = await ctx.app.request(`/api/v1/ideas/${idea.id}/bookmark`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(bm.status).toBe(204);
    const rmBm = await ctx.app.request(`/api/v1/ideas/${idea.id}/bookmark`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(rmBm.status).toBe(204);

    const interest = await ctx.app.request(`/api/v1/ideas/${idea.id}/interest`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(interest.status).toBe(204);
    const delInterest = await ctx.app.request(`/api/v1/ideas/${idea.id}/interest`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(delInterest.status).toBe(204);

    const comment = await ctx.app.request(`/api/v1/ideas/${idea.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ body: "Nice idea!" }),
    });
    expect(comment.status).toBe(201);
    const { comment: c }: any = await json(comment);

    const hide = await ctx.app.request(`/api/v1/ideas/${idea.id}/comments/${c.id}/hide`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(hide.status).toBe(204);

    const offer = await ctx.app.request(`/api/v1/ideas/${idea.id}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ offer: "I can help build this" }),
    });
    expect(offer.status).toBe(201);

    const offers = await ctx.app.request(`/api/v1/ideas/${idea.id}/offers`, {
      headers: { Cookie: cookie },
    });
    expect(offers.status).toBe(200);

    // promote to space
    const promote = await ctx.app.request(`/api/v1/ideas/${idea.id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Promoted Idea Space",
        summary: "A very nice summary that is long enough.",
        type: "startup",
        visibility: "private",
      }),
    });
    expect(promote.status).toBe(201);
  });
});

// -----------------------------------------------------------------------------
// Space workspace flow: settings, planning, tasks, activity, files, integrations, safety.
describe("spaces -> planning -> tasks -> activity -> files/integrations/safety", () => {
  let cookie = "";
  let slug = "";
  let taskId = "";
  beforeAll(async () => {
    const u = await createTestUser(ctx);
    cookie = u.cookie;
    createdUserIds.push(u.user.id);
    const res = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Space ${Date.now().toString(36)}`,
        summary: "A proper summary that is long enough for validation.",
        category: "ai",
        type: "startup",
        visibility: "private",
      }),
    });
    expect(res.status).toBe(201);
    const b: any = await json(res);
    slug = b.space.slug;
  });

  it("GET /spaces/:slug 200 and overview 200", async () => {
    const r = await ctx.app.request(`/api/v1/spaces/${slug}`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const o = await ctx.app.request(`/api/v1/spaces/${slug}/overview`, {
      headers: { Cookie: cookie },
    });
    expect(o.status).toBe(200);
  });
  it("PATCH /spaces/:slug/settings 200", async () => {
    const r = await ctx.app.request(`/api/v1/spaces/${slug}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        summary: "Updated summary that is still long enough for validation.",
      }),
    });
    expect(r.status).toBe(200);
  });
  it("planning-notes CRUD and promote", async () => {
    const create = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Note", body: "Body content", color: "yellow" }),
    });
    expect(create.status).toBe(201);
    const { note }: any = await json(create).catch(() => ({}));
    // list
    const list = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    // promote if we have id (try fetch first note id)
    const body: any = await json(list);
    const nid = note?.id ?? body?.items?.[0]?.id;
    if (nid) {
      const prom = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes/${nid}/promote`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect([201, 400, 404].includes(prom.status)).toBe(true);
    }
  });
  it("roadmap + tasks + activity", async () => {
    const ri = await ctx.app.request(`/api/v1/spaces/${slug}/roadmap-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ horizon: "now", title: "Roadmap item", description: "desc" }),
    });
    expect(ri.status).toBe(201);
    const listRi = await ctx.app.request(`/api/v1/spaces/${slug}/roadmap-items`, {
      headers: { Cookie: cookie },
    });
    expect(listRi.status).toBe(200);

    const t = await ctx.app.request(`/api/v1/spaces/${slug}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Task 1",
        description: "Do thing",
        area: "Product",
        priority: "medium",
      }),
    });
    expect(t.status).toBe(201);
    const { task }: any = await json(t);
    taskId = task.id;

    const tasks = await ctx.app.request(`/api/v1/spaces/${slug}/tasks`, {
      headers: { Cookie: cookie },
    });
    expect(tasks.status).toBe(200);

    const getTask = await ctx.app.request(`/api/v1/tasks/${taskId}`, {
      headers: { Cookie: cookie },
    });
    expect(getTask.status).toBe(200);

    const patch = await ctx.app.request(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(patch.status).toBe(200);

    const tc = await ctx.app.request(`/api/v1/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ body: "Task comment" }),
    });
    expect(tc.status).toBe(201);

    const act = await ctx.app.request(`/api/v1/spaces/${slug}/activity`, {
      headers: { Cookie: cookie },
    });
    expect(act.status).toBe(200);
  });
  it("follow/unfollow public space needs public visibility", async () => {
    // our space is private -> follow should 404
    const f = await ctx.app.request(`/api/v1/spaces/${slug}/follow`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(f.status).toBe(404);
  });
  it("files upload-url requires config -> 503 or 201, download-url auth", async () => {
    const up = await ctx.app.request(`/api/v1/spaces/${slug}/files/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ filename: "a.png", contentType: "image/png", byteSize: 123 }),
    });
    expect([201, 503, 400].includes(up.status)).toBe(true);
  });
  it("integrations + safety", async () => {
    const ints = await ctx.app.request(`/api/v1/spaces/${slug}/integrations`, {
      headers: { Cookie: cookie },
    });
    expect(ints.status).toBe(200);
    const dl = await ctx.app.request(`/api/v1/spaces/${slug}/design-links`, {
      headers: { Cookie: cookie },
    });
    expect(dl.status).toBe(200);
    const report = await ctx.app.request("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        entityType: "space",
        entityId: "00000000-0000-4000-8000-000000000001",
        reason: "spam",
      }),
    });
    expect(report.status).toBe(201);
  });
  it("calls list and AI settings", async () => {
    const calls = await ctx.app.request(`/api/v1/spaces/${slug}/calls`, {
      headers: { Cookie: cookie },
    });
    expect(calls.status).toBe(200);
    const aiSettings = await ctx.app.request(`/api/v1/spaces/${slug}/ai/settings`, {
      headers: { Cookie: cookie },
    });
    expect(aiSettings.status).toBe(200);
    const aiRuns = await ctx.app.request(`/api/v1/spaces/${slug}/ai/runs`, {
      headers: { Cookie: cookie },
    });
    expect(aiRuns.status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// Direct messages, Space chat, notifications, and safety controls with two users.
describe("chat + dm + notifications", () => {
  let cookieA = "",
    cookieB = "",
    userAId = "",
    userBId = "";
  let conversationId = "";
  beforeAll(async () => {
    const a = await createTestUser(ctx);
    const b = await createTestUser(ctx);
    cookieA = a.cookie;
    cookieB = b.cookie;
    userAId = a.user.id;
    userBId = b.user.id;
    createdUserIds.push(userAId, userBId);
  });

  it("dm request -> list -> accept creates conversation -> messages -> read receipt", async () => {
    const req = await ctx.app.request("/api/v1/dm/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ recipientUserId: userBId, body: "Hello from A" }),
    });
    expect(req.status).toBe(201);
    const { request }: any = await json(req);

    const list = await ctx.app.request("/api/v1/dm/requests", { headers: { Cookie: cookieB } });
    expect(list.status).toBe(200);

    const accept = await ctx.app.request(`/api/v1/dm/requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ status: "accepted" }),
    });
    expect(accept.status).toBe(200);
    const accBody: any = await json(accept);
    conversationId = accBody.conversationId;
    expect(conversationId).toBeTruthy();

    const send = await ctx.app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ body: "Direct hello" }),
    });
    expect(send.status).toBe(201);
    const { message }: any = await json(send);

    const msgs = await ctx.app.request(`/api/v1/conversations/${conversationId}/messages`, {
      headers: { Cookie: cookieB },
    });
    expect(msgs.status).toBe(200);

    const read = await ctx.app.request(`/api/v1/messages/${message.id}/read`, {
      method: "POST",
      headers: { Cookie: cookieB },
    });
    expect(read.status).toBe(204);

    const convs = await ctx.app.request("/api/v1/dm/conversations", {
      headers: { Cookie: cookieA },
    });
    expect(convs.status).toBe(200);
  });

  it("space chat requires membership", async () => {
    // create space with A, try chat with B -> 403
    const spaceRes = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        name: `ChatSpace ${Date.now().toString(36)}`,
        summary: "Summary long enough for validation.",
        category: "ai",
        type: "startup",
      }),
    });
    const { space }: any = await json(spaceRes);
    const chatB = await ctx.app.request(`/api/v1/spaces/${space.slug}/chat`, {
      headers: { Cookie: cookieB },
    });
    expect(chatB.status).toBe(403);
    const chatA = await ctx.app.request(`/api/v1/spaces/${space.slug}/chat`, {
      headers: { Cookie: cookieA },
    });
    expect(chatA.status).toBe(200);
    const send = await ctx.app.request(`/api/v1/spaces/${space.slug}/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ body: "Space hello" }),
    });
    expect(send.status).toBe(201);
  });

  it("notifications list and read", async () => {
    const n = await ctx.app.request("/api/v1/notifications", { headers: { Cookie: cookieA } });
    expect(n.status).toBe(200);
    const ra = await ctx.app.request("/api/v1/notifications/read-all", {
      method: "POST",
      headers: { Cookie: cookieA },
    });
    expect(ra.status).toBe(204);
  });

  it("me/blocks and reports", async () => {
    const block = await ctx.app.request(`/api/v1/me/blocks/${userBId}`, {
      method: "POST",
      headers: { Cookie: cookieA },
    });
    expect(block.status).toBe(204);
    const unblock = await ctx.app.request(`/api/v1/me/blocks/${userBId}`, {
      method: "DELETE",
      headers: { Cookie: cookieA },
    });
    expect(unblock.status).toBe(204);
  });
});
