export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER !== "false") {
    const { startWorker } = await import("./lib/jobs/worker");
    // Guarded by a globalThis flag inside startWorker against double start in dev.
    await startWorker();
  }
}
