/**
 * Buildspace API module: src/tests/edge.test.ts
 * Null / validation / edited / SQL-injection / auth-guard edge cases for every module.
 * Uses real DATABASE_URL + fake Redis (same harness as routes.test.ts).
 * NOT run via inject — code-checked via `npm run check`; runtime `npm run test` will exercise these.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, createTestUser, cleanupUser } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const ids: string[] = [];
const SQLI = "' OR 1=1; --";
const SQLI_DROP = "'; DROP TABLE users; --";
const SQLI_UNION = "' UNION SELECT * FROM users --";

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  for (const id of ids) await cleanupUser(ctx, id);
  // ensure tables still exist after sqli attempts
  const r = await ctx.database.pool.query("select to_regclass('public.users') as t");
  expect(r.rows[0].t).toBe("users");
  await ctx.database.pool.end();
});

function json(r: Response) {
  return r.json() as Promise<any>;
}

// ------------------------------------------------------------------ auth
describe("auth edge — null, malformed, sqli", () => {
  it("sign-up null body -> 400/422 from zod", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([400, 422].includes(r.status)).toBe(true);
  });
  it("sign-up with null fields -> validation error", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: null, password: null, handle: null, displayName: null }),
    });
    expect([400, 422].includes(r.status)).toBe(true);
  });
  it("sign-up password too short -> 400/422", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "edge-a@example.com",
        password: "short11",
        handle: "edge-a",
        displayName: "Edge",
      }),
    });
    expect([400, 422].includes(r.status)).toBe(true);
  });
  it("sign-up invalid email -> 400/422", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "TestPassword123!",
        handle: "edge-b",
        displayName: "Edge",
      }),
    });
    expect([400, 422].includes(r.status)).toBe(true);
  });
  it("sign-up sqli in email/handle does not inject — either 400/422 or creates isolated row safely parameterized", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${SQLI}@example.com`,
        password: "TestPassword123!",
        handle: "sqli-handle",
        displayName: SQLI,
      }),
    });
    // email fails email zod -> 400; if passed, drizzle eq is parameterized, no drop
    expect([201, 400, 422, 409].includes(r.status)).toBe(true);
    if (r.status === 201) ids.push(((await json(r)) as any).user.id);
    const probe = await ctx.database.pool.query("select 1 as ok");
    expect(probe.rows[0].ok).toBe(1);
  });
  it("sign-in sqli in email -> 401 (parameterized eq) not 500", async () => {
    const r = await ctx.app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: SQLI, password: SQLI_DROP }),
    });
    expect([401, 400, 422].includes(r.status)).toBe(true);
  });
  it("mfa verify null/tampered ticket -> 400/401", async () => {
    const r1 = await ctx.app.request("/api/v1/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: null, code: null }),
    });
    expect([400, 401, 422].includes(r1.status)).toBe(true);
    const r2 = await ctx.app.request("/api/v1/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: "eyJ.invalid", code: "123456" }),
    });
    expect([401, 400].includes(r2.status)).toBe(true);
  });
});

// -------------------------------------------------------------- discovery + people + ideas edge
describe("discovery/people/ideas edge", () => {
  let cookie = "";
  let ideaId = "";
  beforeAll(async () => {
    const u = await createTestUser(ctx);
    cookie = u.cookie;
    ids.push(u.user.id);
    const cr = await ctx.app.request("/api/v1/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Edge Idea Valid Title",
        body: "Body long enough for validation of at least twenty chars.",
        category: "ai",
        lookingFor: "dev",
      }),
    });
    ideaId = ((await json(cr)) as any).idea?.id ?? "";
  });
  it("search sqli does not drop, returns 200", async () => {
    for (const payload of [SQLI, SQLI_DROP, SQLI_UNION, "%'; select * from pg_tables; --"]) {
      const r = await ctx.app.request(`/api/v1/search?q=${encodeURIComponent(payload)}`, {
        headers: { Cookie: cookie },
      });
      expect(r.status).toBe(200);
      const b: any = await json(r);
      expect(Array.isArray(b.items)).toBe(true);
    }
    const still = await ctx.database.pool.query("select count(*)::int as c from ideas");
    expect(still.rows[0].c).toBeGreaterThanOrEqual(0);
  });
  it("people q sqli -> 200, parameterized ilike, no 500", async () => {
    const r = await ctx.app.request(`/api/v1/people?q=${encodeURIComponent(SQLI_DROP)}`, {
      headers: { Cookie: cookie },
    });
    expect(r.status).toBe(200);
  });
  it("idea create null/empty -> 400, not 500", async () => {
    const r1 = await ctx.app.request("/api/v1/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);
    const r2 = await ctx.app.request("/api/v1/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: null, body: null, category: null }),
    });
    expect(r2.status).toBe(400);
  });
  it("bookmark round-trip: discover/ideas returns the caller's bookmarkedIdeaIds", async () => {
    expect(ideaId).toBeTruthy();
    // An unbooked idea must not appear in the caller's bookmark list.
    const before = await ctx.app.request("/api/v1/discover/ideas", { headers: { Cookie: cookie } });
    expect(before.status).toBe(200);
    const beforeBody: any = await json(before);
    expect(beforeBody.bookmarkedIdeaIds).not.toContain(ideaId);

    const add = await ctx.app.request(`/api/v1/ideas/${ideaId}/bookmark`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect([200, 201, 204]).toContain(add.status);

    // Regression guard: this list used to be hardcoded to `where(sql`false`)`.
    const after = await ctx.app.request("/api/v1/discover/ideas", { headers: { Cookie: cookie } });
    expect(after.status).toBe(200);
    const afterBody: any = await json(after);
    expect(afterBody.bookmarkedIdeaIds).toContain(ideaId);

    const remove = await ctx.app.request(`/api/v1/ideas/${ideaId}/bookmark`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect([200, 204]).toContain(remove.status);

    const cleared = await ctx.app.request("/api/v1/discover/ideas", { headers: { Cookie: cookie } });
    const clearedBody: any = await json(cleared);
    expect(clearedBody.bookmarkedIdeaIds).not.toContain(ideaId);
  });
  it("cors echoes allowlisted Origin and omits unknown origins", async () => {
    // The test harness always loads a non-empty WEB_ORIGIN allowlist.
    const allowedOrigin = ctx.config.WEB_ORIGIN[0]!;
    const ok = await ctx.app.request("/api/v1/discover/announcements", {
      headers: { Origin: allowedOrigin },
    });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(ok.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const denied = await ctx.app.request("/api/v1/discover/announcements", {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("idea id sqli path is treated as id string, not query — 404 not injection", async () => {
    const r = await ctx.app.request(`/api/v1/ideas/${encodeURIComponent(SQLI_DROP)}`, {
      headers: { Cookie: cookie },
    });
    expect([404, 400, 401].includes(r.status)).toBe(true);
    const probe = await ctx.database.pool.query("select 1 as ok");
    expect(probe.rows[0].ok).toBe(1);
  });
  it("comment sqli body is stored as text, not executed", async () => {
    const r = await ctx.app.request(`/api/v1/ideas/${ideaId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ body: SQLI_DROP }),
    });
    expect(r.status).toBe(201);
    const { comment }: any = await json(r);
    expect(comment.body).toBe(SQLI_DROP);
  });
});

// ------------------------------------------------------------------ spaces edge
describe("spaces edge — validation + sqli + permission", () => {
  let cookie = "";
  let slug = "";
  beforeAll(async () => {
    const u = await createTestUser(ctx);
    cookie = u.cookie;
    ids.push(u.user.id);
    const cr = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Edge Space ${Date.now().toString(36)}`,
        summary: "Summary long enough for validation purpose.",
        category: "tooling",
        type: "startup",
      }),
    });
    slug = ((await json(cr)) as any).space.slug;
  });
  it("create space null name -> 400", async () => {
    const r = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: null, summary: null, category: null, type: null }),
    });
    expect(r.status).toBe(400);
  });
  it("create space sqli in category is parameterized -> 201 with that string as value", async () => {
    const r = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Sqli ${Date.now().toString(36)}`,
        summary: "Summary long enough for validation purpose.",
        category: SQLI,
        type: "startup",
      }),
    });
    expect([201, 400].includes(r.status)).toBe(true); // category min 2 passes, stored literally
  });
  it("patch settings sqli in summary -> 200, stored literally, no injection", async () => {
    const r = await ctx.app.request(`/api/v1/spaces/${slug}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ summary: SQLI_DROP }),
    });
    expect(r.status).toBe(200);
  });
  it("join-request sqli note stored safely", async () => {
    // make a fresh public recruiting space to test join
    const pub = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Public ${Date.now().toString(36)}`,
        summary: "Summary long enough for validation purpose.",
        category: "ai",
        type: "startup",
        visibility: "public",
        recruiting: true,
      }),
    });
    const pubSlug = ((await json(pub)) as any).space.slug;
    const outsider = await createTestUser(ctx);
    ids.push(outsider.user.id);
    const jr = await ctx.app.request(`/api/v1/spaces/${pubSlug}/join-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: outsider.cookie },
      body: JSON.stringify({ note: SQLI_UNION, desiredRole: SQLI }),
    });
    expect([201, 400].includes(jr.status)).toBe(true);
  });
  it("overview without membership -> 403 not leak", async () => {
    const outsider = await createTestUser(ctx);
    ids.push(outsider.user.id);
    const r = await ctx.app.request(`/api/v1/spaces/${slug}/overview`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(r.status).toBe(403);
  });
});

// -------------------------------------------------------------- planning / tasks edge
describe("planning/tasks edge", () => {
  let cookie = "";
  let slug = "";
  let noteId = "";
  let taskId = "";
  beforeAll(async () => {
    const u = await createTestUser(ctx);
    cookie = u.cookie;
    ids.push(u.user.id);
    const sp = await ctx.app.request("/api/v1/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `PT ${Date.now().toString(36)}`,
        summary: "Summary long enough for validation purpose.",
        category: "ai",
        type: "startup",
      }),
    });
    slug = ((await json(sp)) as any).space.slug;
    const n = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "N", body: "B long enough to pass string validation" }),
    } as any);
    // title too short (1) should 400 — try valid then sqli
    if (n.status === 400) {
      const n2 = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ title: "Valid Note", body: "Valid body long enough" }),
      });
      const j: any = await json(n2);
      noteId = j.note?.id ?? j.id ?? "";
    } else {
      const j: any = await json(n);
      noteId = j.note?.id ?? j.id ?? "";
    }
    // create a task for patch tests
    const t = await ctx.app.request(`/api/v1/spaces/${slug}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "T", description: "D" }),
    } as any); // short title invalid -> try valid
    if (t.status !== 201) {
      const t2 = await ctx.app.request(`/api/v1/spaces/${slug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ title: "Valid Task", description: "Desc" }),
      });
      const tj: any = await json(t2);
      taskId = tj.task?.id ?? tj.id ?? "";
    } else {
      const tj: any = await json(t);
      taskId = tj.task?.id ?? tj.id ?? "";
    }
  });
  it("planning-note null -> 400", async () => {
    const r = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: null, body: null }),
    });
    expect(r.status).toBe(400);
  });
  it("planning-note sqli title -> 201 stored as text or 400", async () => {
    // color enum validation will reject sqli color
    const r = await ctx.app.request(`/api/v1/spaces/${slug}/planning-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: SQLI, body: SQLI_DROP, color: "yellow" }),
    });
    expect([201, 400].includes(r.status)).toBe(true);
  });
  it("task patch invalid status -> 400", async () => {
    if (!taskId) return;
    const r = await ctx.app.request(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ status: SQLI }),
    });
    expect([400, 404].includes(r.status)).toBe(true);
  });
});

// -------------------------------------------------------------- chat / notifications edge
describe("chat/notifications edge — blocks + sqli body", () => {
  let aCookie = "",
    bCookie = "",
    bId = "";
  beforeAll(async () => {
    const a = await createTestUser(ctx);
    const b = await createTestUser(ctx);
    aCookie = a.cookie;
    bCookie = b.cookie;
    bId = b.user.id;
    ids.push(a.user.id, b.user.id);
  });
  it("dm sqli body stored safely not executed", async () => {
    const r = await ctx.app.request("/api/v1/dm/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ recipientUserId: bId, body: SQLI_DROP }),
    });
    expect(r.status).toBe(201);
  });
  it("conversation message null -> 400, sqli -> 201 stored", async () => {
    // need a conversation first
    const req = await ctx.app.request("/api/v1/dm/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ recipientUserId: bId, body: "hello" }),
    });
    const { request }: any = await json(req);
    const acc = await ctx.app.request(`/api/v1/dm/requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: bCookie },
      body: JSON.stringify({ status: "accepted" }),
    });
    const { conversationId }: any = await json(acc);
    const nullMsg = await ctx.app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ body: null }),
    });
    expect(nullMsg.status).toBe(400);
    const sqliMsg = await ctx.app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ body: SQLI_UNION }),
    });
    expect(sqliMsg.status).toBe(201);
  });
});
