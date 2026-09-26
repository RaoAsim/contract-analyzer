import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

type DbGlobal = { __caDb?: { sql: postgres.Sql; db: Db } };
const g = globalThis as unknown as DbGlobal;

/**
 * One postgres-js pool per process (reused across dev hot reloads).
 * Supabase's Session pooler supports prepared statements; keep the pool small because the
 * free-plan pooler caps client connections.
 */
function init(): { sql: postgres.Sql; db: Db } {
  if (!g.__caDb) {
    const cfg = getConfig();
    const client = postgres(cfg.DATABASE_URL, {
      max: cfg.DATABASE_POOL_MAX,
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => {},
    });
    g.__caDb = { sql: client, db: drizzle(client, { schema }) };
  }
  return g.__caDb;
}

export function getDb(): Db {
  return init().db;
}

export function getSql(): postgres.Sql {
  return init().sql;
}
