export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
