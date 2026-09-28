export type ApiErrorBody = { error: { code: string; message: string } };

export type HealthResponse = {
  ok: boolean;
  database: "ok" | "error";
  /** One `select 1` round trip; a chat answer makes ~20–30 of these. */
  dbLatencyMs: number;
  storage: "ok" | "error";
  worker: "running" | "stopped" | "disabled";
  /** Only with ?llm=1: Gemini reachable with the configured key and model. */
  llm?: { ok: boolean; ms: number; error?: string };
};
