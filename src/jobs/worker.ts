/**
 * Buildspace API module: src/jobs/worker.ts
 * Runs retryable outbox work such as AI jobs outside the latency-sensitive HTTP process.
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { aiRuns, outboxEvents } from "../db/schema.js";
import { NvidiaAiProvider } from "../providers/nvidia.js";
import { createRedis, publishEvent } from "../realtime/events.js";

const config = loadConfig();
const database = createDatabase(config);
const redisPair = createRedis(config);
await redisPair.client.connect();
async function processOutbox() {
  const pending = await database.db.select().from(outboxEvents).where(and(isNull(outboxEvents.processedAt), lte(outboxEvents.availableAt, new Date()))).orderBy(outboxEvents.createdAt).limit(25);
  for (const event of pending) {
    try {
      if (event.type === "ai.run") {
        const runId = (event.payload as { runId?: string }).runId;
        const run = runId ? (await database.db.select().from(aiRuns).where(eq(aiRuns.id, runId)).limit(1))[0] : undefined;
        if (run) {
          await database.db.update(aiRuns).set({ status: "running", updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
          const prompt = (run.input as { prompt?: string }).prompt ?? "";
          const output = await new NvidiaAiProvider(config).complete([{ role: "system", content: "You are Buildspace Project Memory. Use only authorised Space sources and state uncertainty clearly." }, { role: "user", content: prompt }]);
          await database.db.update(aiRuns).set({ status: "completed", output: { content: output.content }, modelId: output.model, inputTokens: output.usage?.promptTokens ?? null, outputTokens: output.usage?.completionTokens ?? null, updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
          await publishEvent(redisPair.client, { id: event.id, type: "ai.completed", channel: `space:${run.spaceId}`, payload: { runId: run.id }, occurredAt: new Date().toISOString() });
        }
      }
      await database.db.update(outboxEvents).set({ processedAt: new Date(), attempts: event.attempts + 1 }).where(eq(outboxEvents.id, event.id));
    } catch (error) {
      console.error({ eventId: event.id, error }, "Outbox event failed; it will retry.");
      await database.db.update(outboxEvents).set({ attempts: event.attempts + 1, availableAt: new Date(Date.now() + 60_000) }).where(eq(outboxEvents.id, event.id));
    }
  }
}
await processOutbox();
setInterval(() => void processOutbox(), 5_000);
