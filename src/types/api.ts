export type ApiErrorBody = { error: { code: string; message: string } };

export type HealthResponse = {
  ok: boolean;
  database: "ok" | "error";
  storage: "ok" | "error";
  worker: "running" | "stopped" | "disabled";
};
