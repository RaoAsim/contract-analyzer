import type { AnswerMode, Coverage, Notice } from "./chat";
import type { Citation } from "./citation";

export type SseMeta = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  mode: AnswerMode;
  docs: { tag: string; id: string; name: string }[];
  historyIncluded?: { turns: number; dropped: number };
};

/** `hints`: follow-up lines the UI shows in turn while this step is still running. */
export type SseStatus = { text: string; progress?: { done: number; total: number }; hints?: string[] };
export type SseToolCall = { callId: string; name: string; label: string; args: unknown; round: number };
export type SseToolResult = { callId: string; ok: boolean; summary: string; ms: number; error?: string };
export type SseText = { delta: string };
export type SseQuotePending = { id: string; docTag: string };
export type SseError = { code: string; message: string; retryable: boolean };
export type SseDone = { status: "complete" | "stopped" | "error"; messageId: string };

/** Server-sent events on POST /api/conversations/:id/messages (§11.5). */
export type SseEventMap = {
  meta: SseMeta;
  status: SseStatus;
  tool_call: SseToolCall;
  tool_result: SseToolResult;
  text: SseText;
  quote_pending: SseQuotePending;
  citation: Citation;
  coverage: Coverage;
  notice: Notice;
  error: SseError;
  done: SseDone;
};

export type SseEventName = keyof SseEventMap;
