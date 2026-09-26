import type { JobType } from "@/lib/db/schema";
import type { ClaimedJob } from "./queue";

export type JobContext = {
  job: ClaimedJob;
  /** Aborted when the lease is lost (job deleted or re-claimed) or the process shuts down. */
  signal: AbortSignal;
};

export type JobOutcome = "retrying" | "failed";

export type JobHandler = {
  run: (ctx: JobContext) => Promise<void>;
  /** Called after a permanent failure, or a transient failure (retrying or out of attempts). */
  onFailure: (ctx: JobContext, info: { permanent: boolean; outcome: JobOutcome; error: unknown }) => Promise<void>;
};

export type HandlerRegistry = Partial<Record<JobType, JobHandler>>;
