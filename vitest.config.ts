/**
 * Buildspace API module: ./vitest.config.ts
 * Contains a focused responsibility within the standalone Buildspace backend.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    clearMocks: true
  }
});
