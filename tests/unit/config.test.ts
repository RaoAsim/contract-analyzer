import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/postgres",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  GEMINI_API_KEY: "AIza-test",
};

describe("getConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) {
      if (/^(DATABASE_|SUPABASE_|GEMINI_|CONTEXT_|SCAN_|AGENT_|MAX_|RUN_WORKER|ENABLE_DEBUG)/.test(k)) delete process.env[k];
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
    expect(cfg.GEMINI_MODEL).toBe("gemini-flash-latest");
    expect(cfg.GEMINI_THINKING_LEVEL).toBe("LOW");
    expect(cfg.GEMINI_BASE_URL).toBeUndefined();
    expect(cfg.RUN_WORKER).toBe(true);
    expect(cfg.ENABLE_DEBUG_TOGGLES).toBe(false);
  });

  it("accepts the legacy SUPABASE_SERVICE_ROLE_KEY name", async () => {
    Object.assign(process.env, REQUIRED, { SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" });
    delete process.env.SUPABASE_SECRET_KEY;
    const { getConfig } = await import("@/lib/config");
    expect(getConfig().SUPABASE_SECRET_KEY).toBe("legacy-jwt");
  });

  it("coerces numbers, normalises the thinking level and treats empty optional strings as unset", async () => {
    Object.assign(process.env, REQUIRED, { CONTEXT_BUDGET_TOKENS: "12000", GEMINI_BASE_URL: "  ", GEMINI_THINKING_LEVEL: "minimal", RUN_WORKER: "false" });
    const { getConfig } = await import("@/lib/config");
    const cfg = getConfig();
    expect(cfg.CONTEXT_BUDGET_TOKENS).toBe(12000);
    expect(cfg.GEMINI_BASE_URL).toBeUndefined();
    expect(cfg.GEMINI_THINKING_LEVEL).toBe("MINIMAL");
    expect(cfg.RUN_WORKER).toBe(false);
  });

  it("rejects an unknown thinking level", async () => {
    Object.assign(process.env, REQUIRED, { GEMINI_THINKING_LEVEL: "extreme" });
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrowError(/GEMINI_THINKING_LEVEL/);
  });

  it("fails fast with a readable list of every missing variable", async () => {
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrowError(/DATABASE_URL[\s\S]*SUPABASE_SECRET_KEY[\s\S]*GEMINI_API_KEY[\s\S]*\.env\.example/);
  });

  it("never includes secret values in the error message", async () => {
    Object.assign(process.env, REQUIRED, { GEMINI_BASE_URL: "not a url", GEMINI_API_KEY: "AIza-super-secret" });
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrowError(/GEMINI_BASE_URL/);
    try {
      getConfig();
    } catch (e) {
      expect(String(e)).not.toContain("AIza-super-secret");
    }
  });
});
