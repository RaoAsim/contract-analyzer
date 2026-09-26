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

/** Plain-English hints for the connection errors people actually hit with Supabase. */
function hint(code: string | undefined, message: string): string {
  if (code === "28P01" || /password authentication failed/i.test(message)) return "Wrong database password. Reset it in Supabase → Settings → Database, update DATABASE_URL, and URL-encode special characters.";
  if (code === "XX000" && /tenant or user not found/i.test(message)) return "The pooler didn't recognise the user. The Session pooler user must be postgres.<project-ref> (copy the string from Connect → Session pooler).";
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return "The host name can't be resolved. Copy the Session pooler string again (the direct db.<ref>.supabase.co host is IPv6-only on many networks).";
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(message)) return "Couldn't reach the database. Check the host/port (Session pooler, port 5432) and that the project isn't paused.";
  if (/ssl|SSL/.test(message)) return "The server requires SSL. Add ?sslmode=require to DATABASE_URL.";
  if (code === "42501") return "Permission denied. Use the postgres user from the Session pooler string.";
  return "";
}

main().catch((err: unknown) => {
  // Drizzle wraps driver errors as "Failed query: …"; the cause carries the real reason.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = (cause as { code?: string }).code;
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`Migration failed: ${message}${code ? ` (code ${code})` : ""}`);
  const h = hint(code, message);
  if (h) console.error(h);
  process.exit(1);
});
