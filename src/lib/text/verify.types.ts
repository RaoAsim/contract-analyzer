import type { MatchMethod, UnverifiedReason } from "@/types/citation";
import type { Range } from "@/types/document";

export type Span = { start: number; end: number };

export type VerifyResult = {
  status: "verified" | "verified_close" | "unverified";
  method?: MatchMethod;
  score?: number;
  reason?: UnverifiedReason;
  /** Canonical spans of every occurrence (T1/T2 up to 25). Empty when unverified. */
  occurrences: Span[];
  /** Index into `occurrences` chosen by context overlap (§9.5). */
  primary: number;
  /** Elided quotes: one span per segment, for the primary chain. */
  segments?: Span[];
};

export type VerifyOptions = {
  /** Canonical ranges the server actually sent to the model for this answer (§9.5). */
  contextRanges?: readonly Range[];
};
