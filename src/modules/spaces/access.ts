/**
 * Buildspace API module: src/modules/spaces/access.ts
 * Resolves Space membership and permissions in one reusable location for consistent authorisation.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { spaceMemberships, spaceRoles, spaces } from "../../db/schema.js";

export type SpaceAccess = {
  spaceId: string;
  slug: string;
  ownerUserId: string;
  membershipStatus: "invited" | "active" | "removed" | null;
  permissions: string[];
};

/**
 * Space is the primary authorisation boundary. This helper is used before every
 * private Space action, WebSocket subscription, LiveKit join token, and AI query.
 */
export async function resolveSpaceAccess(database: Database, slug: string, userId: string): Promise<SpaceAccess | null> {
  const row = (await database.db.select({
    spaceId: spaces.id,
    slug: spaces.slug,
    ownerUserId: spaces.ownerUserId,
    membershipStatus: spaceMemberships.status,
    permissions: spaceRoles.permissions,
  }).from(spaces)
    .leftJoin(spaceMemberships, and(eq(spaceMemberships.spaceId, spaces.id), eq(spaceMemberships.userId, userId)))
    .leftJoin(spaceRoles, eq(spaceRoles.id, spaceMemberships.roleId))
    .where(eq(spaces.slug, slug)).limit(1))[0];
  if (!row) return null;
  return {
    spaceId: row.spaceId,
    slug: row.slug,
    ownerUserId: row.ownerUserId,
    membershipStatus: row.membershipStatus,
    permissions: Array.isArray(row.permissions) ? row.permissions.filter((value): value is string => typeof value === "string") : [],
  };
}

export function canAccess(access: SpaceAccess | null, userId: string, permission?: string): boolean {
  if (!access) return false;
  if (access.ownerUserId === userId) return true;
  if (access.membershipStatus !== "active") return false;
  return !permission || access.permissions.includes("*") || access.permissions.includes(permission);
}
