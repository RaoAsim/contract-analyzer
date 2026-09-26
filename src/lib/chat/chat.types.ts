import type { DocData } from "@/lib/text/docData.types";
import type { AnswerMode, CoverageDoc, TraceStep } from "@/types/chat";
import type { Citation } from "@/types/citation";
import type { Range } from "@/types/document";
import type { LlmUsage } from "@/lib/llm/llm.types";
import type { Emit } from "./sse";

export type ChatDoc = { tag: string; data: DocData };

export type ChatOptions = { thorough?: boolean; agent?: boolean; debugInjectFakeQuote?: boolean };

/** A document's block in the prompt and what was read from it. */
export type DocContext = {
  tag: string;
  doc: DocData;
  mode: "full" | "retrieval" | "scan";
  body: string;
  coverageAttr: string;
  /** Canonical ranges the model saw (coverage). */
  readRanges: Range[];
  /** Ranges used to pick primary occurrences. */
  contextRanges: Range[];
  failedRanges?: CoverageDoc["failedRanges"];
  noteForModel?: string;
};

/** Mutable state of one assistant answer while it is generated. */
export type AnswerState = {
  content: string;
  citations: Citation[];
  trace: TraceStep[];
  notices: { code: string; text: string; action?: { kind: "thorough"; label: string } }[];
  usage: LlmUsage;
  mode: AnswerMode;
  coverage?: import("@/types/chat").Coverage;
};

export type RunContext = {
  conversationId: string;
  messageId: string;
  question: string;
  docs: ChatDoc[];
  options: ChatOptions;
  signal: AbortSignal;
  emit: Emit;
  state: AnswerState;
  history: import("@/lib/llm/llm.types").ChatMessage[];
  /** Persist partial progress (throttled by the caller). */
  flush: () => void;
  nextCitationId: () => string;
  startedAt: number;
};

export type StreamOutcome = { notFound: boolean; stopped: boolean; text: string; finishReason: string | null };
