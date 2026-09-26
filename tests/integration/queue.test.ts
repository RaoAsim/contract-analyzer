import "dotenv/config";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { JobType } from "@/lib/db/schema";
import { claimJob, completeJob, enqueueJob, heartbeat, retryOrFail } from "@/lib/jobs/queue";

/**
 * Runs against the real Supabase database when DATABASE_URL is set (skipped otherwise).
 * Uses a job type no worker handles, so a running dev server can't steal these jobs.
 */
const url = process.env.DATABASE_URL;
const TEST_TYPE = "queue-test" as unknown as JobType;

describe.skipIf(!url)("job queue (integration)", () => {
  const client = postgres(url ?? "", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema });

  beforeAll(async () => {
    await db.execute(sql`delete from jobs where type = ${TEST_TYPE}`);
  });
  afterAll(async () => {
    await db.execute(sql`delete from jobs where type = ${TEST_TYPE}`);
    await client.end();
  });

  it("enqueue is idempotent while a job is active", async () => {
    const target = randomUUID();
    await enqueueJob(db, TEST_TYPE, target);
    await enqueueJob(db, TEST_TYPE, target);
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from jobs where type = ${TEST_TYPE} and target_id = ${target}`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("claims atomically: two concurrent claims never get the same job", async () => {
    await db.execute(sql`delete from jobs where type = ${TEST_TYPE}`);
    await enqueueJob(db, TEST_TYPE, randomUUID());
    const [a, b] = await Promise.all([claimJob(db, [TEST_TYPE]), claimJob(db, [TEST_TYPE])]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attempts).toBe(1);
  });

  it("re-claims a running job whose lease expired (restart recovery)", async () => {
    await db.execute(sql`delete from jobs where type = ${TEST_TYPE}`);
    await enqueueJob(db, TEST_TYPE, randomUUID());
    const first = await claimJob(db, [TEST_TYPE]);
    expect(first).not.toBeNull();
    // Still leased → not claimable.
    expect(await claimJob(db, [TEST_TYPE])).toBeNull();
    // Simulate the worker dying: the lease runs out.
    await db.execute(sql`update jobs set locked_until = now() - interval '1 second' where id = ${first!.id}`);
    const second = await claimJob(db, [TEST_TYPE]);
    expect(second?.id).toBe(first!.id);
    expect(second?.attempts).toBe(2);
    // The dead worker's heartbeat must no longer succeed.
    expect(await heartbeat(db, first!)).toBe(false);
    expect(await heartbeat(db, second!)).toBe(true);
    await completeJob(db, second!);
  });

  it("transient failure re-queues with backoff, then fails after max attempts", async () => {
    await db.execute(sql`delete from jobs where type = ${TEST_TYPE}`);
    await enqueueJob(db, TEST_TYPE, randomUUID());
    let job = await claimJob(db, [TEST_TYPE]);
    expect(await retryOrFail(db, job!, "boom 1")).toBe("retrying");
    const after = await db.execute<{ status: string; delay: number }>(sql`
      select status, extract(epoch from (run_after - now()))::int as delay from jobs where id = ${job!.id}`);
    expect(after[0]?.status).toBe("queued");
    expect(after[0]?.delay).toBeGreaterThanOrEqual(15); // 10 s × 2^1
    // Not claimable before run_after.
    expect(await claimJob(db, [TEST_TYPE])).toBeNull();

    await db.execute(sql`update jobs set run_after = now(), attempts = 2 where id = ${job!.id}`);
    job = await claimJob(db, [TEST_TYPE]);
    expect(job?.attempts).toBe(3);
    expect(await retryOrFail(db, job!, "boom 3")).toBe("failed");
    const final = await db.execute<{ status: string; last_error: string }>(
      sql`select status, last_error from jobs where id = ${job!.id}`,
    );
    expect(final[0]).toMatchObject({ status: "failed", last_error: "boom 3" });
  });
});
