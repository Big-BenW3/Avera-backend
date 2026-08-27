/**
 * Buildspace API module: src/modules/spaces/access.test.ts
 * Verifies that Space owners and members receive only their intended permissions.
 */

import { describe, expect, it } from "vitest";
import { canAccess } from "./access.js";

describe("Space authorisation", () => {
  it("always permits the Space owner", () => {
    expect(canAccess({ spaceId: "s", slug: "space", ownerUserId: "owner", membershipStatus: null, permissions: [] }, "owner", "tasks:edit")).toBe(true);
  });
  it("requires an active membership and an explicit permission for collaborators", () => {
    const access = { spaceId: "s", slug: "space", ownerUserId: "owner", membershipStatus: "active" as const, permissions: ["tasks:view"] };
    expect(canAccess(access, "member", "tasks:view")).toBe(true);
    expect(canAccess(access, "member", "tasks:edit")).toBe(false);
    expect(canAccess({ ...access, membershipStatus: "removed" }, "member", "tasks:view")).toBe(false);
  });
});
