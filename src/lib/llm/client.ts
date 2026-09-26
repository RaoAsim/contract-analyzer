import "server-only";
import OpenAI, { APIError } from "openai";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { parseWithSchema } from "./json";
import type { CallOptions, ChatMessage, LlmUsage, StreamResult, ToolCallResult, ToolDef } from "./llm.types";
import { countTokens } from "./tokens";

let client: OpenAI | undefined;
// Provider capability flags, learned on the first rejection and kept for the process lifetime.
const caps = { jsonMode: true, streamUsage: true };

function llm(): OpenAI {
  if (!client) {
    const cfg = getConfig();
    // SDK retries are disabled: we retry ourselves so the UI can show a "retrying" notice (§14.4).
    client = new OpenAI({ apiKey: cfg.LLM_API_KEY, baseURL: cfg.LLM_BASE_URL, maxRetries: 0, timeout: 120_000 });
  }
  return client;
}

export function modelName(): string {
  return getConfig().LLM_MODEL;
}

export class LlmUnavailableError extends Error {
  readonly status?: number;
  /** Raw provider message — server-side decisions and logs only, never shown to users. */
  readonly detail: string;
  constructor(message: string, status?: number, detail = "") {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = status;
    this.detail = detail;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError" || /aborted/i.test(err.message));
}

function retryable(err: unknown): boolean {
  if (err instanceof APIError) return err.status === 429 || (err.status !== undefined && err.status >= 500) || err.status === undefined;
  return !isAbortError(err) && err instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|socket|timeout/i.test(err.message);
}

function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof APIError)) return null;
  const h = err.headers?.get?.("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(30_000, secs * 1000);
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : null;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** 429/5xx → retry 3 times with exponential backoff (1 s, 2 s, 4 s) + jitter, honouring retry-after. */
export async function withRetry<T>(fn: () => Promise<T>, opts: Pick<CallOptions, "signal" | "onRetry">, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) throw err;
      if (attempt >= attempts || !retryable(err)) {
        if (err instanceof APIError) throw new LlmUnavailableError(providerMessage(err), err.status, err.message);
        throw err;
      }
      const delay = retryAfterMs(err) ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 400);
      opts.onRetry?.({ attempt: attempt + 1, delayMs: delay, status: err instanceof APIError ? err.status : undefined });
      await sleep(delay, opts.signal);
    }
  }
}

function providerMessage(err: APIError): string {
  if (err.status === 401 || err.status === 403) return "The AI provider rejected the API key.";
  if (err.status === 404) return "The configured AI model was not found at the provider.";
  if (err.status === 429) return "The AI provider is rate-limiting requests. Please try again shortly.";
  if (err.status && err.status >= 500) return "The AI provider is having problems. Please try again shortly.";
  return "The AI provider returned an error.";
}

function logCall(label: string, usage: LlmUsage, ms: number, extra = ""): void {
  // Model, tokens and timing only — never prompts, document text or keys (§17).
  console.log(`[llm] ${label} model=${modelName()} in=${usage.inputTokens} out=${usage.outputTokens} ${ms}ms${extra}`);
}

function estimateInput(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") n += countTokens(c) + 4;
    else if (Array.isArray(c)) for (const part of c) if (typeof (part as { text?: unknown }).text === "string") n += countTokens((part as { text: string }).text);
    const tc = (m as { tool_calls?: { function: { arguments: string } }[] }).tool_calls;
    if (tc) for (const t of tc) n += countTokens(t.function.arguments) + 8;
  }
  return n;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return estimateInput(messages);
}

function rawMessage(err: unknown): string {
  return err instanceof LlmUnavailableError ? err.detail : err instanceof Error ? err.message : "";
}

function status400(err: unknown): boolean {
  return (err instanceof APIError || err instanceof LlmUnavailableError) && err.status === 400;
}

function isStreamOptionsRejection(err: unknown): boolean {
  return status400(err) && /stream_options|include_usage/i.test(rawMessage(err));
}

function isJsonModeRejection(err: unknown): boolean {
  return status400(err) && /response_format|json_object|json mode|json_schema/i.test(rawMessage(err));
}

export function isToolsRejection(err: unknown): boolean {
  const status = err instanceof APIError ? err.status : err instanceof LlmUnavailableError ? err.status : undefined;
  const msg = err instanceof LlmUnavailableError ? err.detail : err instanceof Error ? err.message : "";
  return (status === 400 || status === 404 || status === 422) && /tool|function/i.test(msg);
}

/** Streamed completion. `onDelta` receives text as it arrives; usage falls back to estimates. */
export async function streamChat(messages: ChatMessage[], onDelta: (t: string) => void, opts: CallOptions): Promise<StreamResult> {
  const started = Date.now();
  let text = "";
  let usage: LlmUsage | null = null;
  let finishReason: string | null = null;
  const open = () =>
    llm().chat.completions.create(
      {
        model: modelName(),
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 1800,
        ...(caps.streamUsage ? { stream_options: { include_usage: true } } : {}),
      },
      { signal: opts.signal },
    );
  let stream: Awaited<ReturnType<typeof open>>;
  try {
    stream = await withRetry(open, opts);
  } catch (err) {
    if (caps.streamUsage && isStreamOptionsRejection(err)) {
      caps.streamUsage = false;
      stream = await withRetry(open, opts);
    } else throw err;
  }
  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens, calls: 1 };
    }
  } finally {
    const u = usage ?? { inputTokens: estimateInput(messages), outputTokens: countTokens(text), calls: 1 };
    usage = u;
    logCall(opts.label, u, Date.now() - started, opts.signal?.aborted ? " (stopped)" : "");
  }
  return { text, usage: usage!, finishReason };
}

/** Non-streaming completion with JSON output, validated by zod; one retry with the error (§3). */
export async function chatJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts: CallOptions,
): Promise<{ value: T; usage: LlmUsage }> {
  const total: LlmUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let convo = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const call = () =>
      llm().chat.completions.create(
        {
          model: modelName(),
          messages: convo,
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxTokens ?? 1200,
          ...(caps.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        },
        { signal: opts.signal },
      );
    let resp: Awaited<ReturnType<typeof call>>;
    try {
      resp = await withRetry(call, opts);
    } catch (err) {
      if (caps.jsonMode && isJsonModeRejection(err)) {
        caps.jsonMode = false;
        resp = await withRetry(call, opts);
      } else throw err;
    }
    const content = resp.choices[0]?.message?.content ?? "";
    const u: LlmUsage = {
      inputTokens: resp.usage?.prompt_tokens ?? estimateInput(convo),
      outputTokens: resp.usage?.completion_tokens ?? countTokens(content),
      calls: 1,
    };
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.calls += 1;
    logCall(opts.label, u, Date.now() - started, attempt > 0 ? " (retry)" : "");
    const parsed = parseWithSchema(content, schema);
    if (parsed.ok) return { value: parsed.value, usage: total };
    if (attempt === 0) {
      convo = [
        ...messages,
        { role: "assistant", content },
        { role: "user", content: `${parsed.error} Reply again with ONLY the corrected JSON object.` },
      ];
      continue;
    }
    throw new Error(`Invalid JSON from model: ${parsed.error}`);
  }
  throw new Error("unreachable");
}

/** Non-streaming call with tools (agent research rounds, §14.3). */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDef[],
  opts: CallOptions,
): Promise<ToolCallResult> {
  const started = Date.now();
  const resp = await withRetry(
    () =>
      llm().chat.completions.create(
        {
          model: modelName(),
          messages,
          tools,
          tool_choice: "auto",
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxTokens ?? 1200,
        },
        { signal: opts.signal },
      ),
    opts,
  );
  const message = resp.choices[0]?.message;
  if (!message) throw new LlmUnavailableError("The AI provider returned an empty response.");
  const usage: LlmUsage = {
    inputTokens: resp.usage?.prompt_tokens ?? estimateInput(messages),
    outputTokens: resp.usage?.completion_tokens ?? countTokens(message.content ?? ""),
    calls: 1,
  };
  logCall(opts.label, usage, Date.now() - started, ` tools=${message.tool_calls?.length ?? 0}`);
  return { message, usage, finishReason: resp.choices[0]?.finish_reason ?? null };
}
