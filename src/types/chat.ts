import type { Range } from "./document";

export type AnswerMode = "full" | "retrieval" | "scan" | "agent";

export type MessageRole = "user" | "assistant";

export type MessageStatus = "streaming" | "complete" | "stopped" | "interrupted" | "error";

export type CoverageDoc = {
  docId: string;
  tag: string;
  name: string;
  /** Excluding furniture. */
  totalChars: number;
  /** Canonical ranges the model actually saw (merged). */
  readRanges: Range[];
  /** Read chars / totalChars. */
  fraction: number;
  /** "3–5, 41–44, 88" (PDF) */
  pagesRead?: string;
  /** "§3, §12–14" (DOCX / agent) */
  sectionsRead?: string;
  unreadablePages?: number[];
  failedRanges?: { pageStart: number; pageEnd: number; reason: string; label?: string }[];
  /** Agent mode: check_entire_document ran with complete coverage. */
  checkedEntireDocument?: boolean;
};

export type Coverage = {
  mode: AnswerMode;
  /** True ONLY if every doc fraction === 1 and there are no failures or unreadable pages. */
  complete: boolean;
  perDoc: CoverageDoc[];
};

export type TraceStep = {
  round: number;
  callId: string;
  name: string;
  label: string;
  args: unknown;
  ok: boolean;
  summary: string;
  ms: number;
  error?: string;
};

export type Usage = { inputTokens: number; outputTokens: number; calls: number };

export type MessageError = { code: string; message: string; retryable: boolean };

export type Notice = { code: string; text: string; action?: { kind: "thorough"; label: string } };

export type ConversationDoc = { tag: string; documentId: string | null; name: string; kind?: "pdf" | "docx" };

export type ConversationSummary = {
  id: string;
  title: string;
  kind: "single" | "multi";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  documents: ConversationDoc[];
};

export type MessageView = {
  id: string;
  role: MessageRole;
  content: string;
  citations: import("./citation").Citation[];
  coverage: Coverage | null;
  trace: TraceStep[];
  notices: Notice[];
  mode: AnswerMode | null;
  status: MessageStatus;
  error: MessageError | null;
  usage: Usage | null;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: MessageView[];
};
