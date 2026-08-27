/**
 * Buildspace API module: src/modules/activity/service.ts
 * Writes auditable activity records so mutations can be rendered and broadcast consistently.
 */

import type { Database } from "../../db/client.js";
import { activityEvents, outboxEvents } from "../../db/schema.js";

/**
 * A transactional activity record is appended for important user-visible changes.
 * The matching outbox event lets workers deliver notifications and WebSocket hints
 * without risking data loss if Redis or an external provider is unavailable.
 */
export async function recordActivity(database: Database, input: {
  spaceId: string; actorUserId?: string; type: string; entityType: string; entityId: string; payload?: Record<string, unknown>;
}) {
  const payload = input.payload ?? {};
  await database.db.transaction(async (transaction) => {
    await transaction.insert(activityEvents).values({ ...input, payload });
    await transaction.insert(outboxEvents).values({ type: "space.activity", aggregateType: input.entityType, aggregateId: input.entityId, payload: { spaceId: input.spaceId, actorUserId: input.actorUserId ?? null, event: input.type, ...payload } });
  });
}
