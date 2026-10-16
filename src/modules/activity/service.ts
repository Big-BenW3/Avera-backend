/**
 * Buildspace API module: src/modules/activity/service.ts
 * Writes auditable activity records so mutations can be rendered and broadcast consistently.
 */

import type { Database } from "../../db/client.js";
import { activityEvents } from "../../db/schema.js";

/**
 * An activity record is appended for important user-visible changes so the
 * mutation can be rendered consistently everywhere it appears.
 */
export async function recordActivity(
  database: Database,
  input: {
    spaceId: string;
    actorUserId?: string;
    type: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  },
) {
  const payload = input.payload ?? {};
  await database.db.insert(activityEvents).values({ ...input, payload });
}
