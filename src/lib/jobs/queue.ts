import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { jobs, type JobRow, type JobType } from "@/lib/db/schema";

export const LEASE_SECONDS = 120;
export const BACKOFF_BASE_SECONDS = 10;

type Executor = Pick<Db, "insert" | "execute">;

/**
 * Enqueue a job. The partial unique index on (type, target_id) WHERE status IN ('queued','running')
 * makes this a no-op if an active job already exists for the target.
 */
export async function enqueueJob(db: Executor, type: JobType, targetId: string): Promise<void> {
  await db
    .insert(jobs)
    .values({ type, targetId })
    .onConflictDoNothing({
      target: [jobs.type, jobs.targetId],
      where: sql`status in ('queued', 'running')`,
    });
}

type RawJob = {
  id: string;
  type: JobType;
  target_id: string;
  status: JobRow["status"];
  attempts: number;
  max_attempts: number;
};

export type ClaimedJob = {
  id: string;
  type: JobType;
  targetId: string;
  attempts: number;
  maxAttempts: number;
};

/**
 * Atomically claim the oldest runnable job of the given types, taking a lease (§8.12).
 * A `running` job whose lease expired (its worker died) is claimable again.
 */
export async function claimJob(db: Pick<Db, "execute">, types: JobType[]): Promise<ClaimedJob | null> {
  if (types.length === 0) return null;
  const rows = await db.execute<RawJob>(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1,
           locked_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
        AND ((status = 'queued' AND run_after <= now())
          OR (status = 'running' AND locked_until < now()))
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
    RETURNING id, type, target_id, status, attempts, max_attempts`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    targetId: row.target_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

/** Extends the lease. Returns false if the job is no longer ours (deleted or re-claimed). */
export async function heartbeat(db: Pick<Db, "execute">, job: ClaimedJob): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE jobs SET locked_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
    WHERE id = ${job.id} AND status = 'running' AND attempts = ${job.attempts}
    RETURNING id`);
  return rows.length > 0;
}

export async function completeJob(db: Pick<Db, "execute">, job: ClaimedJob): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL, updated_at = now()
    WHERE id = ${job.id} AND attempts = ${job.attempts}`);
}

export async function failJob(db: Pick<Db, "execute">, job: ClaimedJob, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET status = 'failed', locked_until = NULL, last_error = ${error.slice(0, 2000)},
           updated_at = now()
    WHERE id = ${job.id} AND attempts = ${job.attempts}`);
}

/**
 * Transient failure: re-queue with exponential backoff (10 s × 2^attempts) while attempts remain,
 * otherwise mark failed. Returns what happened so the caller can update the target's status.
 */
export async function retryOrFail(
  db: Pick<Db, "execute">,
  job: ClaimedJob,
  error: string,
): Promise<"retrying" | "failed"> {
  if (job.attempts >= job.maxAttempts) {
    await failJob(db, job, error);
    return "failed";
  }
  const delay = BACKOFF_BASE_SECONDS * 2 ** job.attempts;
  await db.execute(sql`
    UPDATE jobs SET status = 'queued', locked_until = NULL, last_error = ${error.slice(0, 2000)},
           run_after = now() + make_interval(secs => ${delay}), updated_at = now()
    WHERE id = ${job.id} AND attempts = ${job.attempts}`);
  return "retrying";
}
