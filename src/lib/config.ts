import "server-only";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const intWithDefault = (def: number, min = 1) => z.coerce.number().int().min(min).default(def);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Supabase Session pooler string)"),
  DATABASE_POOL_MAX: intWithDefault(8),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL like https://<ref>.supabase.co"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("documents"),

  LLM_BASE_URL: z.string().url("LLM_BASE_URL must be a URL"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),

  EMBEDDING_BASE_URL: optionalString,
  EMBEDDING_API_KEY: optionalString,
  EMBEDDING_MODEL: optionalString,
  EMBEDDING_DIMENSIONS: intWithDefault(1536),

  CONTEXT_BUDGET_TOKENS: intWithDefault(20000, 2000),
  SCAN_WINDOW_TOKENS: intWithDefault(8000, 1000),
  SCAN_CONCURRENCY: intWithDefault(4),
  AGENT_MAX_ROUNDS: intWithDefault(8),
  AGENT_MAX_TOOL_CALLS: intWithDefault(20),
  MAX_UPLOAD_MB: intWithDefault(50),
  MAX_PAGES: intWithDefault(500),
  RUN_WORKER: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  ENABLE_DEBUG_TOGGLES: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/**
 * Parses and validates the environment once. Throws a readable error listing every
 * missing or invalid variable, so a misconfigured deploy fails fast (§6).
 */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Non-secret limits for the UI. Never throws, so pages render even if the env is incomplete. */
export function publicLimits(): { maxUploadMb: number; maxPages: number } {
  const num = (v: string | undefined, d: number): number => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return { maxUploadMb: num(process.env.MAX_UPLOAD_MB, 50), maxPages: num(process.env.MAX_PAGES, 500) };
}
