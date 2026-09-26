/**
 * Provider-neutral chat types used across the app. The Gemini adapter (client.ts) converts them to
 * Gemini `contents`; keeping our own shape means prompts, history and the agent loop don't depend on
 * one SDK's types.
 */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type SystemMessage = { role: "system"; content: string };
export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  /**
   * The provider's raw response parts. Gemini requires model turns with function calls to be sent
   * back exactly as received (thought signatures), so research rounds replay these verbatim.
   */
  providerParts?: unknown[];
};
export type ToolMessage = { role: "tool"; tool_call_id: string; content: string };

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type LlmUsage = { inputTokens: number; outputTokens: number; calls: number };

export type RetryHook = (info: { attempt: number; delayMs: number; status?: number }) => void;

export type CallOptions = {
  signal?: AbortSignal;
  /** Visible output budget. Thinking tokens are added on top by the client (they count against the cap). */
  maxTokens?: number;
  temperature?: number;
  onRetry?: RetryHook;
  /** Label for logs only ("answer", "scan-map", "agent-round"…). */
  label: string;
};

/** Normalised finish reasons: "stop", "length" (hit the token cap), "tool_calls", "blocked", "recitation". */
export type FinishReason = "stop" | "length" | "tool_calls" | "blocked" | "recitation" | (string & {});

export type StreamResult = { text: string; usage: LlmUsage; finishReason: FinishReason | null };

export type ToolCallResult = { message: AssistantMessage; usage: LlmUsage; finishReason: FinishReason | null };
