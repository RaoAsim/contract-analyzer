export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Google's API has IPv6 addresses; on hosts without outbound IPv6 an IPv6 attempt can hang.
  (await import("node:dns")).setDefaultResultOrder("ipv4first");
  console.log(
    `[boot] node ${process.version} · model=${process.env.GEMINI_MODEL ?? "(default)"} · thinking=${process.env.GEMINI_THINKING_LEVEL ?? "low"} · region=${process.env.RAILWAY_REPLICA_REGION ?? "local"}`,
  );
  // The private bucket is created through the Storage API (SQL on the storage schema is restricted
  // on Supabase). Idempotent; a failure is logged and surfaces in /api/health.
  const { ensureBucket } = await import("./lib/storage/supabase");
  ensureBucket()
    .then((r) => r === "created" && console.log("[storage] created private bucket"))
    .catch((err: unknown) => console.error("[storage] bucket check failed:", err instanceof Error ? err.message : err));
  if (process.env.RUN_WORKER !== "false") {
    const { startWorker } = await import("./lib/jobs/worker");
    // Guarded by a globalThis flag inside startWorker against double start in dev.
    await startWorker();
  }
}
