import type OpenAI from "openai";

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ToolDef = OpenAI.Chat.Completions.ChatCompletionTool;
export type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionMessage;

export type LlmUsage = { inputTokens: number; outputTokens: number; calls: number };

export type RetryHook = (info: { attempt: number; delayMs: number; status?: number }) => void;

export type CallOptions = {
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  onRetry?: RetryHook;
  /** Label for logs only ("answer", "scan-map", "agent-round"…). */
  label: string;
};

export type StreamResult = { text: string; usage: LlmUsage; finishReason: string | null };

export type ToolCallResult = { message: AssistantMessage; usage: LlmUsage; finishReason: string | null };
