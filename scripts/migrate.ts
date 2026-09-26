import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** A readable reason why a connection string can't be used (never echoes the password). */
export function databaseUrlProblem(url: string): string | null {
  if (/[<>]/.test(url)) return "it still contains a <placeholder> such as <password> or <project-ref>. Replace it, including the angle brackets.";
  if (!/^postgres(ql)?:\/\//.test(url)) return "it must start with postgresql://";
  if (!URL.canParse(url)) {
    return "it is not a valid URL. If your database password contains special characters (@ : / ? # % & etc.), URL-encode them (e.g. @ → %40, # → %23) or reset the password to letters and digits.";
  }
  const u = new URL(url);
  if (u.port === "6543") return "port 6543 is the transaction pooler; use the Session pooler string (port 5432) from Connect → Session pooler.";
  return null;
}

/** Applies ./drizzle migrations to DATABASE_URL (the Supabase Session pooler string). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  const problem = databaseUrlProblem(url);
  if (problem) throw new Error(`DATABASE_URL is not usable: ${problem}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    const tables = await sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`;
    const noRls = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
    console.log(`Migrations applied. ${tables.length} public tables.`);
    if (noRls.length > 0) {
      console.error(`RLS is OFF on: ${noRls.join(", ")}. Every public table must have RLS enabled.`);
      process.exitCode = 1;
    } else {
      console.log("RLS is enabled on every public table.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
