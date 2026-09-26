import "server-only";
import { sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import type { JobType } from "@/lib/db/schema";
import { JobAbortedError, PermanentJobError } from "./errors";
import { claimJob, completeJob, failJob, heartbeat, retryOrFail, type ClaimedJob } from "./queue";
import type { HandlerRegistry, JobContext } from "./worker.types";
import { jobHandlers } from "./handlers";

const CONCURRENCY = 2;
const POLL_MS = 1000;
const HEARTBEAT_MS = 30_000;
const STALE_STREAMING_MINUTES = 3;

type WorkerState = { started: boolean; running: number; lastTickAt: number; stopping: boolean };
type WorkerGlobal = { __caWorker?: WorkerState };
const g = globalThis as unknown as WorkerGlobal;

function state(): WorkerState {
  g.__caWorker ??= { started: false, running: 0, lastTickAt: 0, stopping: false };
  return g.__caWorker;
}

export function workerStatus(): "running" | "stopped" {
  const s = state();
  // A healthy loop ticks every second; allow slack for a slow DB round trip.
  return s.started && Date.now() - s.lastTickAt < 30_000 ? "running" : "stopped";
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function runJob(job: ClaimedJob, registry: HandlerRegistry): Promise<void> {
  const db = getDb();
  const handler = registry[job.type];
  if (!handler) return; // claimJob only returns registered types
  const controller = new AbortController();
  const ctx: JobContext = { job, signal: controller.signal };

  const beat = setInterval(() => {
    heartbeat(db, job)
      .then((ours) => {
        if (!ours) controller.abort(new JobAbortedError("lease lost"));
      })
      .catch((err: unknown) => console.warn(`[worker] heartbeat failed for job ${job.id}:`, errorText(err)));
  }, HEARTBEAT_MS);

  const started = Date.now();
  try {
    await handler.run(ctx);
    await completeJob(db, job);
    console.log(`[worker] ${job.type} ${job.targetId} done in ${Date.now() - started} ms`);
  } catch (err) {
    if (err instanceof JobAbortedError || controller.signal.aborted) {
      // Target deleted or lease lost: exit quietly. Mark done so a deleted target is not retried.
      await completeJob(db, job).catch(() => {});
      console.log(`[worker] ${job.type} ${job.targetId} aborted: ${errorText(err)}`);
      return;
    }
    const permanent = err instanceof PermanentJobError;
    const message = errorText(err);
    const outcome = permanent ? "failed" : await retryOrFail(db, job, message);
    if (permanent) await failJob(db, job, message);
    console.warn(
      `[worker] ${job.type} ${job.targetId} ${permanent ? "failed permanently" : outcome} ` +
        `(attempt ${job.attempts}/${job.maxAttempts}): ${message}`,
    );
    await handler
      .onFailure(ctx, { permanent, outcome, error: err })
      .catch((e: unknown) => console.error(`[worker] onFailure for job ${job.id} threw:`, errorText(e)));
  } finally {
    clearInterval(beat);
  }
}

/** At boot, answers left `streaming` by a dead process become `interrupted`, keeping partial text (§8.12). */
async function recoverInterruptedMessages(): Promise<void> {
  const rows = await getDb().execute<{ id: string }>(sql`
    UPDATE messages SET status = 'interrupted', completed_at = now(), updated_at = now()
    WHERE status = 'streaming'
      AND updated_at < now() - make_interval(mins => ${STALE_STREAMING_MINUTES})
    RETURNING id`);
  if (rows.length > 0) console.log(`[worker] marked ${rows.length} stale streaming message(s) interrupted`);
}

async function tick(registry: HandlerRegistry, types: JobType[]): Promise<void> {
  const s = state();
  s.lastTickAt = Date.now();
  while (!s.stopping && s.running < CONCURRENCY) {
    const job = await claimJob(getDb(), types);
    if (!job) return;
    s.running++;
    void runJob(job, registry).finally(() => {
      s.running--;
    });
  }
}

/**
 * Starts the polling loop once per process. Returns immediately; the loop runs in the background
 * so `instrumentation.register()` does not block server start-up.
 */
export async function startWorker(registry: HandlerRegistry = jobHandlers): Promise<void> {
  const s = state();
  if (s.started) return;
  try {
    getConfig();
  } catch (err) {
    console.error(`[worker] not started — ${errorText(err)}`);
    return;
  }
  s.started = true;
  s.lastTickAt = Date.now();
  const types = Object.keys(registry) as JobType[];
  console.log(`[worker] starting (concurrency ${CONCURRENCY}; job types: ${types.join(", ") || "none"})`);

  recoverInterruptedMessages().catch((err: unknown) =>
    console.error("[worker] could not recover interrupted messages:", errorText(err)),
  );

  const loop = async (): Promise<void> => {
    while (!s.stopping) {
      try {
        await tick(registry, types);
      } catch (err) {
        console.error("[worker] poll failed:", errorText(err));
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };
  void loop();
}
