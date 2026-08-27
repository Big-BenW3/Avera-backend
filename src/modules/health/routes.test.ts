/**
 * Buildspace API module: src/modules/health/routes.test.ts
 * Confirms the liveness endpoint remains dependency-free and suitable for orchestration probes.
 */

import { describe, expect, it } from "vitest";
import { healthRoutes } from "./routes.js";

describe("operational health endpoints", () => {
  it("reports liveness without asking PostgreSQL or Redis", async () => {
    const response = await healthRoutes().request("/health/live");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", service: "buildspace-api" });
  });
});
