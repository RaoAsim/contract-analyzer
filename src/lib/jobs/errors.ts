/**
 * A failure that retrying cannot fix (unsupported file, no text layer, …). The worker marks the
 * job failed immediately without scheduling a retry (§8.11). Everything else is transient.
 */
export class PermanentJobError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentJobError";
    this.code = code;
  }
}

/** Thrown when the job's target was deleted or its lease was lost; the job exits quietly. */
export class JobAbortedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JobAbortedError";
  }
}
