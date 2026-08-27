/**
 * Buildspace API module: src/db/client.ts
 * Creates the PostgreSQL pool and Drizzle client used by HTTP handlers and workers.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

/**
 * The API owns all PostgreSQL access. The Next.js frontend never receives this URL.
 * A single pool is injected into modules so integration tests can substitute a test DB.
 */
export function createDatabase(config: Pick<AppConfig, "DATABASE_URL">) {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 12 });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
