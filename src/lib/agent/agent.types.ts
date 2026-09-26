import type { z } from "zod";
import type { ChatDoc } from "@/lib/chat/chat.types";
import type { DocData } from "@/lib/text/docData.types";
import type { CoverageDoc } from "@/types/chat";
import type { Range } from "@/types/document";
import type { Ledger } from "./ledger";

export type SearchHit = { start: number; end: number };
export type ClauseHit = { type: string; start: number; end: number };
export type ScanOutcome = { findings: { start: number; end: number }[]; okRanges: Range[]; failedRanges: NonNullable<CoverageDoc["failedRanges"]> };

/** Everything tools need; injected so replay tests run without a database or an LLM. */
export type ToolEnv = {
  docs: ChatDoc[];
  multi: boolean;
  search: (doc: DocData, query: string, limit: number) => Promise<SearchHit[]>;
  clauses: (doc: DocData, type?: string) => Promise<ClauseHit[]>;
  scan: (doc: DocData, question: string, signal: AbortSignal) => Promise<ScanOutcome>;
  signal: AbortSignal;
  ledger: Ledger;
};

/** JSON returned to the model. Errors are results, never exceptions (§14.1). */
export type ToolPayload = Record<string, unknown>;

export type ToolResult = {
  ok: boolean;
  payload: ToolPayload;
  summary: string;
  /** The model called finish_research. */
  finish?: boolean;
  errorCode?: string;
};

export type ToolSpec<A> = {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  /** Keys the schema knows (unknown keys are stripped and reported). */
  keys: string[];
  /** Fields to coerce: "5" → 5 for numbers, 12.3 → "12.3" for strings. */
  numberFields?: string[];
  stringFields?: string[];
  /** Short schema description for INVALID_ARGUMENTS. */
  expected: string;
  /** Ledger cost (check_entire_document counts as 3). */
  cost?: number;
  timeoutMs?: number;
  /** Pauses the agent wall clock while running (long full scans). */
  pausesClock?: boolean;
  run: (args: A, env: ToolEnv) => Promise<ToolResult>;
};

export type AnyTool = ToolSpec<unknown>;

export type RawToolCall = { id: string; name: string; arguments: string };

export type AgentOutcome = "finished" | "cap" | "repeat_failures" | "model_text" | "timeout";
