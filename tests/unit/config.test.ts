import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/postgres",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  LLM_BASE_URL: "https://api.example.com/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "cheap-model",
};

describe("getConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) {
      if (/^(DATABASE_URL|SUPABASE_|LLM_|EMBEDDING_|CONTEXT_|SCAN_|AGENT_|MAX_|RUN_WORKER|ENABLE_DEBUG)/.test(k)) {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("applies documented defaults", async () => {
    Object.assign(process.env, REQUIRED);
    const { getConfig } = await import("@/lib/config");
    const cfg = getConfig();
    expect(cfg.CONTEXT_BUDGET_TOKENS).toBe(20000);
    expect(cfg.SCAN_WINDOW_TOKENS).toBe(8000);
    expect(cfg.AGENT_MAX_ROUNDS).toBe(8);
    expect(cfg.MAX_UPLOAD_MB).toBe(50);
    expect(cfg.SUPABASE_STORAGE_BUCKET).toBe("documents");
    expect(cfg.RUN_WORKER).toBe(true);
    expect(cfg.ENABLE_DEBUG_TOGGLES).toBe(false);
    expect(cfg.EMBEDDING_MODEL).toBeUndefined();
  });

  it("coerces numeric strings and treats empty optional strings as unset", async () => {
    Object.assign(process.env, REQUIRED, { CONTEXT_BUDGET_TOKENS: "12000", EMBEDDING_MODEL: "  ", RUN_WORKER: "false" });
    const { getConfig } = await import("@/lib/config");
    const cfg = getConfig();
    expect(cfg.CONTEXT_BUDGET_TOKENS).toBe(12000);
    expect(cfg.EMBEDDING_MODEL).toBeUndefined();
    expect(cfg.RUN_WORKER).toBe(false);
  });

  it("fails fast with a readable list of every missing variable", async () => {
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrowError(/DATABASE_URL[\s\S]*LLM_API_KEY[\s\S]*\.env\.example/);
  });

  it("never includes secret values in the error message", async () => {
    Object.assign(process.env, REQUIRED, { LLM_BASE_URL: "not a url", LLM_API_KEY: "sk-super-secret" });
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrowError(/LLM_BASE_URL/);
    try {
      getConfig();
    } catch (e) {
      expect(String(e)).not.toContain("sk-super-secret");
    }
  });
});
